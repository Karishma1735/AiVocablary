import express from 'express';
import { z } from 'zod';

export const PRACTICE_CATEGORIES=[
 {id:'about-yourself',label:'Tell me about yourself',description:'Introduce yourself clearly and confidently.',questions:['Tell me about yourself and your professional background.','What are your key strengths?','Where do you see yourself in five years?','What motivated you to choose your current career path?']},
 {id:'job-interview',label:'Job interviews',description:'Answer common interview questions.',questions:['Why do you want to work at our company?','Describe a challenging situation at work and how you handled it.','What is your biggest professional achievement?','How do you handle tight deadlines and pressure?']},
 {id:'workplace',label:'Workplace communication',description:'Everyday communication with managers and colleagues.',questions:['How would you politely disagree with your manager?','How do you ask for clarification when an assignment is unclear?','How would you give constructive feedback to a colleague?','How would you decline a request you cannot take on?']},
 {id:'meetings',label:'Meetings and presentations',description:'Speak up in meetings and present your ideas.',questions:['How would you give a project update to your team?','How would you open a meeting you are leading?','How would you summarise the key points at the end of a meeting?','What would you say when you cannot answer a question in a presentation?']},
 {id:'everyday',label:'Everyday professional conversations',description:'Small talk and polite follow-ups.',questions:['How would you introduce yourself to a new colleague?','How do you make small talk at a networking event?','How would you follow up on an email that has had no reply?','How would you congratulate a colleague on a promotion?']}
];

export const MAX_ANSWER_LENGTH=2000;
export const practiceCheckSchema=z.object({
 category:z.string().min(1).max(50),
 question:z.string().min(1).max(300),
 answer:z.string().trim().min(1,'Please type or speak an answer first.').max(MAX_ANSWER_LENGTH,'Your answer is too long. Please keep it under '+MAX_ANSWER_LENGTH+' characters.'),
 saveHistory:z.boolean().optional()
});

export function findQuestion(categoryId,question){
 const category=PRACTICE_CATEGORIES.find(item=>item.id===categoryId);
 return category&&category.questions.includes(question)?category:null;
}

export function describeAiError(error){
 if(error?.code==='AI_BAD_RESPONSE')return {status:502,message:'The AI sent back feedback we could not read. Please try again.'};
 const code=Number(error?.status||error?.code);
 if(code===429)return {status:429,message:'The AI service is busy or out of quota right now. Please wait a minute and try again.'};
 return {status:502,message:'The AI service could not be reached. Please try again shortly.'};
}

function parseFeedback(value){try{return value?JSON.parse(value):null;}catch{return null;}}
const present=row=>({id:row.id,category:row.category,categoryLabel:PRACTICE_CATEGORIES.find(item=>item.id===row.category)?.label||row.category,question:row.question,answer:row.answer,feedback:parseFeedback(row.feedback),createdAt:row.createdAt});

export function createPracticeRouter({prisma,requireUser,analyze,isConfigured,limiter=(req,res,next)=>next()}){
 const router=express.Router();
 router.use(requireUser);
 router.get('/categories',(req,res)=>res.json({categories:PRACTICE_CATEGORIES,aiConfigured:isConfigured()}));
 router.post('/check',limiter,async(req,res,next)=>{
  try{
   const input=practiceCheckSchema.safeParse(req.body);
   if(!input.success)return res.status(400).json({error:input.error.issues[0]?.message||'Please check your answer.'});
   const {category,question,answer,saveHistory=false}=input.data;
   if(!findQuestion(category,question))return res.status(400).json({error:'Please choose one of the practice questions.'});
   if(!isConfigured())return res.json({aiConfigured:false,feedback:null,saved:false,message:'AI feedback is not set up yet. Ask the app owner to add a Gemini API key on the server.'});
   let feedback;
   try{feedback=await analyze(question,answer);}
   catch(error){const {status,message}=describeAiError(error);return res.status(status).json({error:message});}
   let sessionId=null;
   if(saveHistory){const row=await prisma.practiceSession.create({data:{userId:req.user.id,category,question,answer,feedback:JSON.stringify(feedback)}});sessionId=row.id;}
   res.json({aiConfigured:true,feedback,saved:Boolean(sessionId),sessionId});
  }catch(error){next(error);}
 });
 router.get('/history',async(req,res,next)=>{try{const rows=await prisma.practiceSession.findMany({where:{userId:req.user.id},orderBy:{createdAt:'desc'},take:30});res.json({sessions:rows.map(present)});}catch(error){next(error);}});
 router.delete('/history/:id',async(req,res,next)=>{try{const result=await prisma.practiceSession.deleteMany({where:{id:req.params.id,userId:req.user.id}});if(!result.count)return res.status(404).json({error:'Practice entry not found.'});res.json({ok:true});}catch(error){next(error);}});
 router.delete('/history',async(req,res,next)=>{try{const result=await prisma.practiceSession.deleteMany({where:{userId:req.user.id}});res.json({ok:true,deleted:result.count});}catch(error){next(error);}});
 return router;
}
