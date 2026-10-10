import express from 'express';
import { z } from 'zod';

export const CONVERSATION_CATEGORY='conversation';
export const MAX_ANSWER_LENGTH=2000;
export const practiceCheckSchema=z.object({
 question:z.string().min(1).max(300),
 answer:z.string().trim().min(1,'Please type or speak an answer first.').max(MAX_ANSWER_LENGTH,'Your answer is too long. Please keep it under '+MAX_ANSWER_LENGTH+' characters.'),
 saveHistory:z.boolean().optional()
});

export const practiceQuestionSchema=z.object({recent:z.array(z.string().trim().min(1).max(300)).max(10).default([])});

export function describeAiError(error){
 if(error?.code==='AI_BAD_RESPONSE')return {status:502,message:'The AI sent back feedback we could not read. Please try again.'};
 const code=Number(error?.status||error?.code);
 if(code===429)return {status:429,message:'The AI service is busy or out of quota right now. Please wait a minute and try again.'};
 return {status:502,message:'The AI service could not be reached. Please try again shortly.'};
}

function parseFeedback(value){try{return value?JSON.parse(value):null;}catch{return null;}}
const present=row=>({id:row.id,category:row.category,question:row.question,answer:row.answer,feedback:parseFeedback(row.feedback),createdAt:row.createdAt});

export function createPracticeRouter({prisma,requireUser,analyze,ask,isConfigured,limiter=(req,res,next)=>next()}){
 const router=express.Router();
 router.use(requireUser);
 router.get('/config',(req,res)=>res.json({aiConfigured:isConfigured()}));
 router.post('/question',limiter,async(req,res,next)=>{
  try{
   const input=practiceQuestionSchema.safeParse(req.body??{});
   if(!input.success)return res.status(400).json({error:'Could not read the previous questions.'});
   if(!isConfigured())return res.json({aiConfigured:false,question:null,message:'The AI conversation is not set up yet. Ask the app owner to add a Gemini API key on the server.'});
   try{const question=await ask(input.data.recent);return res.json({aiConfigured:true,question});}
   catch(error){const {status,message}=describeAiError(error);return res.status(status).json({error:message});}
  }catch(error){next(error);}
 });
 router.post('/check',limiter,async(req,res,next)=>{
  try{
   const input=practiceCheckSchema.safeParse(req.body);
   if(!input.success)return res.status(400).json({error:input.error.issues[0]?.message||'Please check your answer.'});
   const {question,answer,saveHistory=false}=input.data;
   if(!isConfigured())return res.json({aiConfigured:false,feedback:null,saved:false,message:'AI feedback is not set up yet. Ask the app owner to add a Gemini API key on the server.'});
   let feedback;
   try{feedback=await analyze(question,answer);}
   catch(error){const {status,message}=describeAiError(error);return res.status(status).json({error:message});}
   let sessionId=null;
   if(saveHistory){const row=await prisma.practiceSession.create({data:{userId:req.user.id,category:CONVERSATION_CATEGORY,question,answer,feedback:JSON.stringify(feedback)}});sessionId=row.id;}
   res.json({aiConfigured:true,feedback,saved:Boolean(sessionId),sessionId});
  }catch(error){next(error);}
 });
 router.get('/history',async(req,res,next)=>{try{const rows=await prisma.practiceSession.findMany({where:{userId:req.user.id},orderBy:{createdAt:'desc'},take:30});res.json({sessions:rows.map(present)});}catch(error){next(error);}});
 router.delete('/history/:id',async(req,res,next)=>{try{const result=await prisma.practiceSession.deleteMany({where:{id:req.params.id,userId:req.user.id}});if(!result.count)return res.status(404).json({error:'Practice entry not found.'});res.json({ok:true});}catch(error){next(error);}});
 router.delete('/history',async(req,res,next)=>{try{const result=await prisma.practiceSession.deleteMany({where:{userId:req.user.id}});res.json({ok:true,deleted:result.count});}catch(error){next(error);}});
 return router;
}
