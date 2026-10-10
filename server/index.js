import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { analyzeAnswer, generateQuestion, generateWord, getAiConfig, verifyAiConnection } from './gemini.js';
import { createPracticeRouter } from './practice.js';
import { computeStreak, dateKey, parseJsonArray } from './lib.js';

const app=express();
const prisma=new PrismaClient();
const scrypt=promisify(scryptCallback);
const PORT=Number(process.env.PORT||4000);
const SESSION_COOKIE='vocab_session';
const SESSION_DAYS=30;
app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');next();});
const authLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many attempts. Please wait a few minutes and try again.'}});
const apiLimiter=rateLimit({windowMs:15*60*1000,limit:180,standardHeaders:'draft-8',legacyHeaders:false});
const integrationLimiter=rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false});
app.use('/api',apiLimiter);
const emailSchema=z.string().trim().toLowerCase().email().max(254);
const SESSION_SECRET=process.env['SESSION_SECRET']||randomBytes(32).toString('hex');
const hash=value=>createHash('sha256').update(SESSION_SECRET+':'+value).digest('hex');
const safeUser=user=>({id:user.id,name:user.name,email:user.email,emailEnabled:user.emailEnabled,createdAt:user.createdAt});
function parseWord(word){return {...word,synonyms:parseJsonArray(word.synonyms),examples:parseJsonArray(word.examples)};}
function cookieValue(req,name){const all=(req.headers.cookie||'').split(';');for(const pair of all){const i=pair.indexOf('=');if(i<0)continue;if(pair.slice(0,i).trim()===name)return decodeURIComponent(pair.slice(i+1).trim());}return null;}
function setSessionCookie(res,token){res.cookie(SESSION_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:SESSION_DAYS*24*60*60*1000});}
async function createSession(userId,res){const token=randomBytes(32).toString('hex');const expiresAt=new Date(Date.now()+SESSION_DAYS*24*60*60*1000);await prisma.session.create({data:{tokenHash:hash(token),userId,expiresAt}});setSessionCookie(res,token);}
async function requireUser(req,res,next){try{const token=cookieValue(req,SESSION_COOKIE);if(!token)return res.status(401).json({error:'Please sign in to continue.'});const session=await prisma.session.findUnique({where:{tokenHash:hash(token)},include:{user:true}});if(!session||session.expiresAt<=new Date()){if(session)await prisma.session.delete({where:{id:session.id}});res.clearCookie(SESSION_COOKIE,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/'});return res.status(401).json({error:'Your session expired. Please sign in again.'});}req.user=session.user;next();}catch(error){next(error);}}
function rateSafeCompare(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a);const right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
function requireIntegration(req,res,next){const key=process.env['INTEGRATION_API_KEY'];if(!key)return res.status(503).json({error:'The integration API is not enabled.'});const supplied=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!rateSafeCompare(supplied,key))return res.status(401).json({error:'Invalid integration credentials.'});next();}

const registerSchema=z.object({name:z.string().trim().min(2).max(60),email:emailSchema,password:z.string().min(8).max(128)});
const loginSchema=z.object({email:emailSchema,password:z.string().min(1).max(128)});
app.post('/api/auth/register',authLimiter,async(req,res,next)=>{try{const input=registerSchema.safeParse(req.body);if(!input.success)return res.status(400).json({error:input.error.issues[0]?.message||'Please check your details.'});const {name,email,password}=input.data;const existing=await prisma.user.findUnique({where:{email}});if(existing)return res.status(409).json({error:'An account with this email already exists.'});const salt=randomBytes(16).toString('hex');const derived=await scrypt(password,salt,64);const passwordHash=salt+':'+Buffer.from(derived).toString('hex');const user=await prisma.user.create({data:{name,email,passwordHash}});await createSession(user.id,res);res.status(201).json({user:safeUser(user)});}catch(error){if(error?.code==='P2002')return res.status(409).json({error:'An account with this email already exists.'});next(error);}});
app.post('/api/auth/login',authLimiter,async(req,res,next)=>{try{const input=loginSchema.safeParse(req.body);if(!input.success)return res.status(400).json({error:'Enter a valid email and password.'});const user=await prisma.user.findUnique({where:{email:input.data.email}});if(!user)return res.status(401).json({error:'Email or password is incorrect.'});const [salt,stored]=user.passwordHash.split(':');const derived=Buffer.from(await scrypt(input.data.password,salt,64));const expected=Buffer.from(stored,'hex');if(derived.length!==expected.length||!timingSafeEqual(derived,expected))return res.status(401).json({error:'Email or password is incorrect.'});await createSession(user.id,res);res.json({user:safeUser(user)});}catch(error){next(error);}});
app.post('/api/auth/logout',async(req,res,next)=>{try{const token=cookieValue(req,SESSION_COOKIE);if(token)await prisma.session.deleteMany({where:{tokenHash:hash(token)}});res.clearCookie(SESSION_COOKIE,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/'});res.json({ok:true});}catch(error){next(error);}});
app.get('/api/auth/me',requireUser,(req,res)=>res.json({user:safeUser(req.user)}));

async function getTodayWord(){
 const today=dateKey();
 const present=await prisma.dailyWord.findUnique({where:{date:today},include:{word:true}});
 if(present)return {daily:present,aiFallback:false};
 let content=null;let aiFallback=false;
 if(getAiConfig().apiKey){try{content=await generateWord();}catch{aiFallback=true;}}
 if(!content){const words=await prisma.vocabularyWord.findMany({where:{source:'seed'},orderBy:{word:'asc'}});if(!words.length)throw new Error('Starter vocabulary is missing. Run npm run db:setup.');const slot=Math.abs(Math.floor(Date.now()/86400000))%words.length;content=words[slot];}
 let word;
 if(content.id)word=content;else word=await prisma.vocabularyWord.upsert({where:{word:content.word.toLowerCase()},update:{},create:{...content,word:content.word.toLowerCase()}});
 try{const daily=await prisma.dailyWord.create({data:{date:today,wordId:word.id},include:{word:true}});return {daily,aiFallback};}
 catch(error){if(error?.code==='P2002'){const daily=await prisma.dailyWord.findUnique({where:{date:today},include:{word:true}});if(daily)return {daily,aiFallback};}throw error;}
}
async function refreshTodayWord(){
 const today=dateKey();
 let content=null;
 if(getAiConfig().apiKey){try{content=await generateWord();}catch(error){console.error('Word generation failed:',error?.message||error);}}
 if(!content)return;
 const word=await prisma.vocabularyWord.upsert({where:{word:content.word.toLowerCase()},update:{},create:{...content,word:content.word.toLowerCase()}});
 await prisma.dailyWord.upsert({where:{date:today},update:{wordId:word.id},create:{date:today,wordId:word.id}});
}
async function currentWordForUser(userId){const {daily,aiFallback}=await getTodayWord();const state=await prisma.userWord.findUnique({where:{userId_wordId:{userId,wordId:daily.wordId}}});return {word:parseWord(daily.word),isSaved:state?.isSaved||false,learnedAt:state?.learnedAt||null,aiFallback};}
async function streakFor(userId){const rows=await prisma.studyActivity.findMany({where:{userId,wordsLearned:{gt:0}},select:{date:true},orderBy:{date:'desc'},take:370});return computeStreak(rows.map(row=>row.date));}

app.post('/api/vocabulary/refresh',requireUser,async(req,res,next)=>{try{await refreshTodayWord();res.json(await currentWordForUser(req.user.id));}catch(error){next(error);}});
app.get('/api/vocabulary/today',requireUser,async(req,res,next)=>{try{res.json(await currentWordForUser(req.user.id));}catch(error){next(error);}});
app.get('/api/dashboard',requireUser,async(req,res,next)=>{try{const [today,totalLearned,savedCount,recent,streak]=await Promise.all([currentWordForUser(req.user.id),prisma.userWord.count({where:{userId:req.user.id,learnedAt:{not:null}}}),prisma.userWord.count({where:{userId:req.user.id,isSaved:true}}),prisma.userWord.findMany({where:{userId:req.user.id,learnedAt:{not:null}},include:{word:true},orderBy:{learnedAt:'desc'},take:4}),streakFor(req.user.id)]);res.json({today,totalLearned,savedCount,streak,recent:recent.map(row=>({word:parseWord(row.word),learnedAt:row.learnedAt}))});}catch(error){next(error);}});
app.get('/api/vocabulary/saved',requireUser,async(req,res,next)=>{try{const rows=await prisma.userWord.findMany({where:{userId:req.user.id,isSaved:true},include:{word:true},orderBy:{savedAt:'desc'}});res.json({words:rows.map(row=>({word:parseWord(row.word),learnedAt:row.learnedAt,savedAt:row.savedAt}))});}catch(error){next(error);}});
app.patch('/api/vocabulary/:wordId/bookmark',requireUser,async(req,res,next)=>{try{const input=z.object({saved:z.boolean()}).safeParse(req.body);if(!input.success)return res.status(400).json({error:'Invalid bookmark change.'});const word=await prisma.vocabularyWord.findUnique({where:{id:req.params.wordId}});if(!word)return res.status(404).json({error:'Word not found.'});const state=await prisma.userWord.upsert({where:{userId_wordId:{userId:req.user.id,wordId:word.id}},create:{userId:req.user.id,wordId:word.id,isSaved:input.data.saved,savedAt:input.data.saved?new Date():null},update:{isSaved:input.data.saved,savedAt:input.data.saved?new Date():null}});res.json({isSaved:state.isSaved});}catch(error){next(error);}});
app.patch('/api/vocabulary/:wordId/learn',requireUser,async(req,res,next)=>{try{const word=await prisma.vocabularyWord.findUnique({where:{id:req.params.wordId}});if(!word)return res.status(404).json({error:'Word not found.'});const now=new Date();const state=await prisma.userWord.upsert({where:{userId_wordId:{userId:req.user.id,wordId:word.id}},create:{userId:req.user.id,wordId:word.id,learnedAt:now},update:{}});if(!state.learnedAt){const changed=await prisma.userWord.updateMany({where:{id:state.id,learnedAt:null},data:{learnedAt:now}});if(changed.count){await prisma.studyActivity.upsert({where:{userId_date:{userId:req.user.id,date:dateKey(now)}},create:{userId:req.user.id,date:dateKey(now),wordsLearned:1},update:{wordsLearned:{increment:1}}});}}res.json({learned:true,learnedAt:state.learnedAt||now});}catch(error){next(error);}});
app.get('/api/progress',requireUser,async(req,res,next)=>{try{const [totalLearned,streak,activities,recent]=await Promise.all([prisma.userWord.count({where:{userId:req.user.id,learnedAt:{not:null}}}),streakFor(req.user.id),prisma.studyActivity.findMany({where:{userId:req.user.id},orderBy:{date:'desc'},take:7}),prisma.userWord.findMany({where:{userId:req.user.id,learnedAt:{not:null}},include:{word:true},orderBy:{learnedAt:'desc'},take:10})]);res.json({totalLearned,streak,activities:activities.reverse(),recent:recent.map(row=>({word:parseWord(row.word),learnedAt:row.learnedAt}))});}catch(error){next(error);}});
app.patch('/api/profile',requireUser,async(req,res,next)=>{try{const input=z.object({name:z.string().trim().min(2).max(60),email:emailSchema,emailEnabled:z.boolean()}).safeParse(req.body);if(!input.success)return res.status(400).json({error:input.error.issues[0]?.message||'Please check your profile details.'});const collision=await prisma.user.findFirst({where:{email:input.data.email,id:{not:req.user.id}}});if(collision)return res.status(409).json({error:'That email address is already in use.'});const user=await prisma.user.update({where:{id:req.user.id},data:input.data});res.json({user:safeUser(user)});}catch(error){next(error);}});
app.post('/api/settings/test-ai',requireUser,authLimiter,async(req,res,next)=>{try{res.json(await verifyAiConnection());}catch(error){next(error);}});

const practiceLimiter=rateLimit({windowMs:60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many requests. Please wait a minute and try again.'}});
app.use('/api/practice',createPracticeRouter({prisma,requireUser,analyze:analyzeAnswer,ask:generateQuestion,isConfigured:()=>Boolean(getAiConfig().apiKey),limiter:practiceLimiter}));

app.use('/api/integrations/v1',integrationLimiter,requireIntegration);
app.get('/api/integrations/v1/users/:userId',async(req,res,next)=>{try{const user=await prisma.user.findUnique({where:{id:req.params.userId}});if(!user)return res.status(404).json({error:'User not found.'});res.json({id:user.id,email:user.email,deliveryPreferences:{enabled:user.emailEnabled}});}catch(error){next(error);}});
app.get('/api/integrations/v1/users/:userId/next-word',async(req,res,next)=>{
 try{
  const user=await prisma.user.findUnique({where:{id:req.params.userId}});
  if(!user)return res.status(404).json({error:'User not found.'});
  if(!user.emailEnabled)return res.status(409).json({error:'This user has not enabled daily email delivery.'});
  const today=dateKey();
  let log=await prisma.deliveryLog.findUnique({where:{userId_date:{userId:user.id,date:today}}});
  if(log?.status==='sent')return res.status(409).json({error:'A vocabulary email was already recorded for this user today.'});
  let word;
  if(log){word=await prisma.vocabularyWord.findUnique({where:{id:log.wordId}});}
  else{
   const {daily}=await getTodayWord();word=daily.word;
   const state=await prisma.userWord.findUnique({where:{userId_wordId:{userId:user.id,wordId:word.id}}});
   if(state?.learnedAt){
    const all=await prisma.vocabularyWord.findMany({where:{source:'seed'},orderBy:{word:'asc'},take:50});
    const learned=await prisma.userWord.findMany({where:{userId:user.id,learnedAt:{not:null}},select:{wordId:true}});
    const learnedIds=new Set(learned.map(row=>row.wordId));word=all.find(item=>!learnedIds.has(item.id));
    if(!word)return res.status(404).json({error:'No eligible vocabulary words are available.'});
   }
   try{log=await prisma.deliveryLog.create({data:{userId:user.id,wordId:word.id,date:today,status:'pending'}});}
   catch(error){if(error?.code!=='P2002')throw error;log=await prisma.deliveryLog.findUnique({where:{userId_date:{userId:user.id,date:today}}});if(log?.status==='sent')return res.status(409).json({error:'A vocabulary email was already recorded for this user today.'});word=await prisma.vocabularyWord.findUnique({where:{id:log.wordId}});}
  }
  if(!word)return res.status(404).json({error:'The delivery word is no longer available.'});
  res.json({deliveryId:log.id,date:log.date,recipient:user.email,word:parseWord(word)});
 }catch(error){next(error);}
});
app.post('/api/integrations/v1/deliveries/:deliveryId',async(req,res,next)=>{try{const input=z.object({status:z.enum(['sent','failed']),error:z.string().max(300).optional()}).safeParse(req.body);if(!input.success)return res.status(400).json({error:'Status must be sent or failed.'});const log=await prisma.deliveryLog.findUnique({where:{id:req.params.deliveryId}});if(!log)return res.status(404).json({error:'Delivery record not found.'});if(log.status==='sent')return res.json({ok:true,status:'sent',duplicate:true});const updated=await prisma.deliveryLog.update({where:{id:log.id},data:{status:input.data.status,attempts:{increment:1},deliveredAt:input.data.status==='sent'?new Date():null,error:input.data.status==='failed'?(input.data.error||'Delivery failed.'):null}});res.json({ok:true,status:updated.status,duplicate:false});}catch(error){next(error);}});

app.get('/api/health',(req,res)=>res.json({ok:true,aiConfigured:Boolean(getAiConfig().apiKey),model:getAiConfig().model}));
if(process.env.NODE_ENV==='production'){
 const {fileURLToPath}=await import('node:url');const {dirname,resolve}=await import('node:path');const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');app.use(express.static(resolve(root,'dist')));app.use((req,res,next)=>req.path.startsWith('/api')?next():res.sendFile(resolve(root,'dist/index.html')));
}
app.use((err,req,res,next)=>{console.error(err);if(res.headersSent)return next(err);const status=Number(err.status)||500;res.status(status).json({error:status>=500?'Something went wrong. Please try again.':err.message||'Request failed.'});});
const server=app.listen(PORT,'0.0.0.0',()=>console.log('VocabRise API listening on '+PORT));
async function shutdown(){server.close(async()=>{await prisma.$disconnect();process.exit(0);});}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
