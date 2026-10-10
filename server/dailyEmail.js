import { dateKey, parseJsonArray } from './lib.js';
import { PAGE_SIZE, buildEmail, collectBatch, countsAsDelivered, nextStep, REVISION_PER_DAY, toEmailWord, toSheetRow } from './delivery.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const MAX_ATTEMPTS=5;

export function createDailyEmail({prisma,generate}){
 const deliveredWhere=userId=>({userId,status:{not:'failed'}});

 // A new word the user has never been sent: ask the AI (telling it what to avoid), check, retry, then fall back to the starter list.
 async function pickNewWord(userId){
  const sent=await prisma.deliveryLog.findMany({where:{userId,mode:'new'},orderBy:{date:'desc'},select:{word:{select:{word:true}}}});
  const sentSet=new Set(sent.map(row=>row.word.word.toLowerCase()));
  const recent=[...sentSet].slice(0,150);
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
   let content=null;
   try{content=await generate(recent);}catch(error){console.error('Word generation failed:',error?.message||error);}
   if(!content)continue;
   const key=content.word.toLowerCase();
   if(sentSet.has(key)){recent.unshift(key);continue;}
   return prisma.vocabularyWord.upsert({where:{word:key},update:{},create:{...content,word:key}});
  }
  const seeds=await prisma.vocabularyWord.findMany({where:{source:'seed'},orderBy:{word:'asc'}});
  const fresh=seeds.find(word=>!sentSet.has(word.word.toLowerCase()));
  if(fresh)return fresh;
  throw fail(503,'No unused vocabulary word could be produced right now. Try again shortly.');
 }

 async function revisionWords(userId,start,total){
  // The word list lives in a store that returns at most PAGE_SIZE rows per request, so read it a page at a time.
  const fetchPage=(offset,limit)=>prisma.deliveryLog.findMany({where:{...deliveredWhere(userId),mode:'new'},orderBy:[{date:'asc'},{id:'asc'}],skip:offset,take:limit,select:{wordId:true}});
  const rows=await collectBatch(start,REVISION_PER_DAY,total,fetchPage,PAGE_SIZE);
  const words=await prisma.vocabularyWord.findMany({where:{id:{in:rows.map(row=>row.wordId)}}});
  const byId=new Map(words.map(word=>[word.id,word]));
  return rows.map(row=>byId.get(row.wordId)).filter(Boolean);
 }

 async function payloadFor(log,user){
  const ids=parseJsonArray(log.wordIds);
  const found=await prisma.vocabularyWord.findMany({where:{id:{in:ids}}});
  const byId=new Map(found.map(word=>[word.id,word]));
  const words=ids.map(id=>byId.get(id)).filter(Boolean).map(toEmailWord);
  if(!words.length)throw fail(404,'The delivery words are no longer available.');
  const email=buildEmail({mode:log.mode,words,dayNumber:log.dayNumber});
  return {deliveryId:log.id,date:log.date,recipient:user.email,mode:log.mode,cycle:log.cycle,dayNumber:log.dayNumber,subject:email.subject,textBody:email.text,htmlBody:email.html,words,
   // Only brand-new words are added to the sheet; revision words are already in it.
   sheetRows:log.mode==='new'?words.map(toSheetRow):[]};
 }

 async function dailyFor(user){
  const today=dateKey();
  let log=await prisma.deliveryLog.findUnique({where:{userId_date:{userId:user.id,date:today}}});
  if(log?.status==='sent')throw fail(409,'A vocabulary email was already recorded for this user today.');
  if(!log){
   const history=await prisma.deliveryLog.findMany({where:deliveredWhere(user.id),orderBy:[{date:'asc'},{id:'asc'}],select:{cycle:true,mode:true,wordIds:true}});
   const logs=history.map(row=>({cycle:row.cycle,mode:row.mode,count:parseJsonArray(row.wordIds).length}));
   const totalLearned=logs.filter(row=>row.mode==='new').length;
   const step=nextStep(logs,totalLearned);
   let words;
   if(step.mode==='new')words=[await pickNewWord(user.id)];
   else{words=await revisionWords(user.id,step.revisionStart,totalLearned);if(!words.length)throw fail(404,'No learned words are available to revise.');}
   try{log=await prisma.deliveryLog.create({data:{userId:user.id,wordId:words[0].id,date:today,status:'pending',mode:step.mode,cycle:step.cycle,dayNumber:history.length+1,wordIds:JSON.stringify(words.map(word=>word.id))}});}
   catch(error){if(error?.code!=='P2002')throw error;log=await prisma.deliveryLog.findUnique({where:{userId_date:{userId:user.id,date:today}}});if(log?.status==='sent')throw fail(409,'A vocabulary email was already recorded for this user today.');}
  }
  return payloadFor(log,user);
 }
 return {dailyFor};
}
