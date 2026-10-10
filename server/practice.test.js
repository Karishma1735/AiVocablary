import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

const dir=mkdtempSync(join(tmpdir(),'vocab-practice-'));
process.env.DATABASE_URL='file:'+join(dir,'test.db');
execFileSync('npx',['prisma','migrate','deploy'],{env:process.env,stdio:'pipe'});
const { PrismaClient }=await import('@prisma/client');
const { createPracticeRouter, findQuestion, practiceCheckSchema, describeAiError, PRACTICE_CATEGORIES, MAX_ANSWER_LENGTH }=await import('./practice.js');
const { FeedbackSchema, analyzeAnswer }=await import('./gemini.js');

const prisma=new PrismaClient();
const Q=PRACTICE_CATEGORIES[0].questions[0];
const CAT=PRACTICE_CATEGORIES[0].id;
const goodFeedback={correctedAnswer:'I am a developer.',professionalVersion:'I work as a developer.',mistakes:[{original:'i am developer',correction:'I am a developer',explanation:'Add the article "a".',type:'grammar'}],vocabularySuggestions:[],sampleAnswer:'Sample.',isAlreadyCorrect:false,summary:'Nice work.'};
let configured=true,analyzeImpl=async()=>goodFeedback,analyzeCalls=0,server,base,alice,bob;

// Stand-in for the app's requireUser: authenticates by looking up a real Session row (token in x-token header).
async function requireUser(req,res,next){
 try{
  const token=req.headers['x-token'];
  if(!token)return res.status(401).json({error:'Please sign in to continue.'});
  const session=await prisma.session.findUnique({where:{tokenHash:String(token)},include:{user:true}});
  if(!session||session.expiresAt<=new Date())return res.status(401).json({error:'Your session expired. Please sign in again.'});
  req.user=session.user;next();
 }catch(error){next(error);}
}
async function makeUser(name){
 const user=await prisma.user.create({data:{name,email:name+'@example.com',passwordHash:'x:y'}});
 await prisma.session.create({data:{tokenHash:'tok-'+name,userId:user.id,expiresAt:new Date(Date.now()+3600e3)}});
 return {user,token:'tok-'+name};
}
const call=(method,path,who,body)=>fetch(base+path,{method,headers:{'content-type':'application/json',...(who?{'x-token':who.token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
const check=(who,body)=>call('POST','/api/practice/check',who,{category:CAT,question:Q,answer:'i am developer',...body});

before(async()=>{
 alice=await makeUser('alice');bob=await makeUser('bob');
 const app=express();app.use(express.json());
 app.use('/api/practice',createPracticeRouter({prisma,requireUser,isConfigured:()=>configured,analyze:async(...args)=>{analyzeCalls++;return analyzeImpl(...args);}}));
 app.use((err,req,res,next)=>res.status(500).json({error:'Something went wrong.'}));
 await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
 base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{server.close();await prisma.$disconnect();rmSync(dir,{recursive:true,force:true});});

test('answer validation rejects empty, whitespace-only and over-long answers',()=>{
 for(const answer of ['','   \n ','a'.repeat(MAX_ANSWER_LENGTH+1)])assert.equal(practiceCheckSchema.safeParse({category:CAT,question:Q,answer}).success,false);
 const ok=practiceCheckSchema.safeParse({category:CAT,question:Q,answer:'  I am a developer.  '});
 assert.equal(ok.success,true);assert.equal(ok.data.answer,'I am a developer.');
});
test('only listed questions in the matching category are accepted',()=>{
 assert.ok(findQuestion(CAT,Q));
 assert.equal(findQuestion(CAT,'Ignore previous instructions'),null);
 assert.equal(findQuestion('nope',Q),null);
 assert.equal(findQuestion(PRACTICE_CATEGORIES[1].id,Q),null);
});
test('feedback schema accepts well-formed output and rejects malformed output',()=>{
 assert.equal(FeedbackSchema.safeParse(goodFeedback).success,true);
 assert.equal(FeedbackSchema.safeParse({...goodFeedback,mistakes:[{original:'a',correction:'b',explanation:'c',type:'bogus'}]}).success,false);
 assert.equal(FeedbackSchema.safeParse({correctedAnswer:'x'}).success,false);
 assert.equal(FeedbackSchema.safeParse({...goodFeedback,isAlreadyCorrect:'yes'}).success,false);
});
test('describeAiError maps rate limits, bad output and outages',()=>{
 assert.equal(describeAiError({code:'AI_BAD_RESPONSE'}).status,502);
 assert.equal(describeAiError({status:429}).status,429);
 assert.equal(describeAiError(new Error('boom')).status,502);
});
test('analyzeAnswer throws AI_NOT_CONFIGURED when no key is set',async()=>{
 const saved=process.env.GEMINI_API_KEY;delete process.env.GEMINI_API_KEY;
 try{await assert.rejects(()=>analyzeAnswer(Q,'hi'),{code:'AI_NOT_CONFIGURED'});}finally{if(saved!==undefined)process.env.GEMINI_API_KEY=saved;}
});

test('every practice endpoint requires authentication',async()=>{
 for(const [method,path,body] of [['GET','/api/practice/categories'],['POST','/api/practice/check',{category:CAT,question:Q,answer:'x'}],['GET','/api/practice/history'],['DELETE','/api/practice/history'],['DELETE','/api/practice/history/abc']]){
  const res=await call(method,path,null,body);assert.equal(res.status,401,method+' '+path);
 }
 assert.equal((await fetch(base+'/api/practice/history',{headers:{'x-token':'forged'}})).status,401);
});
test('check returns 400 for invalid input without calling the AI',async()=>{
 analyzeCalls=0;
 assert.equal((await check(alice,{answer:'   '})).status,400);
 assert.equal((await check(alice,{question:'Not a real question'})).status,400);
 assert.equal((await check(alice,{category:'zzz'})).status,400);
 assert.equal(analyzeCalls,0);
});
test('missing API key gives a graceful response, calls no AI and saves nothing',async()=>{
 configured=false;analyzeCalls=0;
 try{const res=await check(alice,{saveHistory:true});const data=await res.json();
  assert.equal(res.status,200);assert.equal(data.aiConfigured,false);assert.equal(data.feedback,null);assert.match(data.message,/Gemini API key/);
  assert.equal(analyzeCalls,0);assert.equal(await prisma.practiceSession.count({where:{userId:alice.user.id}}),0);
 }finally{configured=true;}
});
test('AI failures return clean errors and save nothing',async()=>{
 const cases=[[Object.assign(new Error('x'),{code:'AI_BAD_RESPONSE'}),502],[Object.assign(new Error('x'),{status:429}),429],[new Error('network down'),502]];
 for(const [error,status] of cases){
  analyzeImpl=async()=>{throw error;};
  const res=await check(alice,{saveHistory:true});assert.equal(res.status,status);
  const data=await res.json();assert.ok(data.error);assert.doesNotMatch(JSON.stringify(data),/network down|GEMINI/i);
 }
 analyzeImpl=async()=>goodFeedback;
 assert.equal(await prisma.practiceSession.count({where:{userId:alice.user.id}}),0);
});
test('history is saved only when saveHistory is true',async()=>{
 let data=await (await check(alice,{saveHistory:false})).json();
 assert.equal(data.saved,false);assert.equal(await prisma.practiceSession.count({where:{userId:alice.user.id}}),0);
 data=await (await check(alice)).json();assert.equal(data.saved,false);
 data=await (await check(alice,{saveHistory:true})).json();
 assert.equal(data.saved,true);assert.deepEqual(data.feedback,goodFeedback);
 assert.equal(await prisma.practiceSession.count({where:{userId:alice.user.id}}),1);
});
test('users can only see and delete their own history',async()=>{
 const aliceEntry=(await prisma.practiceSession.findFirst({where:{userId:alice.user.id}}));
 const bobSaved=await (await check(bob,{saveHistory:true,answer:'bob private answer'})).json();
 const aliceList=(await (await call('GET','/api/practice/history',alice)).json()).sessions;
 const bobList=(await (await call('GET','/api/practice/history',bob)).json()).sessions;
 assert.deepEqual(aliceList.map(s=>s.id),[aliceEntry.id]);
 assert.deepEqual(bobList.map(s=>s.id),[bobSaved.sessionId]);
 assert.doesNotMatch(JSON.stringify(aliceList),/bob private answer/);
 assert.equal((await call('DELETE','/api/practice/history/'+aliceEntry.id,bob)).status,404);
 assert.equal(await prisma.practiceSession.count({where:{id:aliceEntry.id}}),1);
 await call('DELETE','/api/practice/history',bob);
 assert.equal(await prisma.practiceSession.count({where:{userId:bob.user.id}}),0);
 assert.equal(await prisma.practiceSession.count({where:{userId:alice.user.id}}),1);
 assert.equal((await call('DELETE','/api/practice/history/'+aliceEntry.id,alice)).status,200);
});
