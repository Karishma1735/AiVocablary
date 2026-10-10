import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
const fence=String.fromCharCode(96).repeat(3);
const WordSchema=z.object({word:z.string().min(2).max(60),pronunciation:z.string().min(2).max(80),partOfSpeech:z.string().min(2).max(40),meaning:z.string().min(12).max(280),hindiMeaning:z.string().min(2).max(160),synonyms:z.array(z.string().min(1).max(50)).min(2).max(5),examples:z.array(z.string().min(10).max(220)).min(2).max(4)});
export function getAiConfig(){return {apiKey:process.env['GEMINI_API_KEY']?.trim(),model:process.env['GEMINI_MODEL']?.trim()||'gemini-3.8-flash'};}
export async function generateWord(){
 const {apiKey,model}=getAiConfig();
 if(!apiKey) throw Object.assign(new Error('Gemini is not configured.'),{code:'AI_NOT_CONFIGURED'});
 const ai=new GoogleGenAI({apiKey});
 const response=await ai.models.generateContent({model,contents:'Create one useful, natural business English vocabulary word for an English learner in India. Avoid rare jargon. Return only a valid JSON object with keys word, pronunciation (simple respelling), partOfSpeech, meaning (plain English), hindiMeaning (Devanagari), synonyms (array of 3), examples (array of 2 realistic workplace sentences). No markdown. Choose a word that is not a basic beginner word.'});
 const raw=(response.text||'').trim().replaceAll(fence+'json','').replaceAll(fence,'').trim();
 let data; try{data=JSON.parse(raw);}catch{throw Object.assign(new Error('Gemini returned invalid JSON.'),{code:'AI_BAD_RESPONSE'});}
 const parsed=WordSchema.safeParse(data); if(!parsed.success) throw Object.assign(new Error('Gemini returned vocabulary in an unexpected format.'),{code:'AI_BAD_RESPONSE'});
 return {...parsed.data,synonyms:JSON.stringify(parsed.data.synonyms),examples:JSON.stringify(parsed.data.examples),source:'gemini'};
}
export async function verifyAiConnection(){
 const {apiKey,model}=getAiConfig();
 if(!apiKey)return {ok:false,model,message:'Add GEMINI_API_KEY in the server environment, then test again.'};
 try{const ai=new GoogleGenAI({apiKey});await ai.models.generateContent({model,contents:'Reply with the single word OK.'});return {ok:true,model,message:'The configured key can use this model.'};}
 catch(error){const code=error?.status||error?.code;const message=code===429?'The model is reachable, but the account is rate-limited or out of quota.':'The model could not be reached with this key. Check the key, account access, region, and model name.';return {ok:false,model,message};}
}
