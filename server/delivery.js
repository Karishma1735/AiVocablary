import { parseJsonArray } from './lib.js';

// Daily vocabulary schedule, per user:
//   new words for NEW_DAYS days (never repeating a word), then revision at REVISION_PER_DAY words a day
//   until every learned word has been revised once, then a fresh cycle of new words starts again.
export const NEW_DAYS=365;
export const REVISION_PER_DAY=10;
// The database (a Google Sheet or table) hands back at most this many rows per request.
export const PAGE_SIZE=200;

// logs: this user's deliveries in date order, as { cycle, mode, count } (failed ones left out).
// totalLearned: how many distinct words have been sent as new words so far.
export function nextStep(logs,totalLearned,{newDays=NEW_DAYS}={}){
 if(!logs.length)return {mode:'new',cycle:1,revisionStart:0};
 const cycle=logs[logs.length-1].cycle;
 const inCycle=logs.filter(log=>log.cycle===cycle);
 const newDaysDone=inCycle.filter(log=>log.mode==='new').length;
 const revised=inCycle.filter(log=>log.mode==='revision').reduce((sum,log)=>sum+log.count,0);
 if(newDaysDone<newDays)return {mode:'new',cycle,revisionStart:0};
 if(revised<totalLearned)return {mode:'revision',cycle,revisionStart:revised};
 return {mode:'new',cycle:cycle+1,revisionStart:0};
}

// Reads `count` items starting at `start` from a source that only returns PAGE_SIZE rows at a time.
// fetchPage(offset, limit) -> rows. Fetches only the pages it needs, so a batch that crosses a page boundary takes two calls.
export async function collectBatch(start,count,total,fetchPage,pageSize=PAGE_SIZE){
 const end=Math.min(start+count,total);
 const rows=[];
 let offset=Math.floor(start/pageSize)*pageSize;
 while(offset<end){
  const page=await fetchPage(offset,pageSize);
  if(!page.length)break;
  page.forEach((row,index)=>{const position=offset+index;if(position>=start&&position<end)rows.push(row);});
  offset+=pageSize;
 }
 return rows;
}

export const countsAsDelivered=log=>log.status!=='failed';

const esc=text=>String(text).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
export function toEmailWord(word){
 return {word:word.word,pronunciation:word.pronunciation,partOfSpeech:word.partOfSpeech,englishMeaning:word.meaning,hindiMeaning:word.hindiMeaning,useCases:parseJsonArray(word.examples)};
}
export function buildEmail({mode,words,dayNumber}){
 const subject=mode==='new'?`Your word for today: ${words[0].word}`:`Revision day: ${words.length} words to revisit`;
 const text=words.map(item=>[item.word.toUpperCase()+(item.pronunciation?' ('+item.pronunciation+')':''),'English: '+item.englishMeaning,'Hindi: '+item.hindiMeaning,'Use cases:',...item.useCases.map(useCase=>' - '+useCase)].join('\n')).join('\n\n');
 const intro=mode==='new'?'Here is your new business word for today.':'Time to revise. Here are '+words.length+' words you learned earlier.';
 const html='<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><p>'+esc(intro)+'</p>'+words.map(item=>'<div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:12px 0"><h2 style="margin:0 0 6px">'+esc(item.word)+'</h2><p style="margin:0 0 8px;color:#6b7280">'+esc(item.pronunciation||'')+' '+esc(item.partOfSpeech||'')+'</p><p style="margin:4px 0"><b>English:</b> '+esc(item.englishMeaning)+'</p><p style="margin:4px 0"><b>हिन्दी:</b> '+esc(item.hindiMeaning)+'</p><p style="margin:8px 0 4px"><b>Use cases</b></p><ul style="margin:0;padding-left:20px">'+item.useCases.map(useCase=>'<li>'+esc(useCase)+'</li>').join('')+'</ul></div>').join('')+'<p style="color:#9ca3af;font-size:12px">Day '+dayNumber+' of your vocabulary plan.</p></div>';
 return {subject,text,html};
}
// One row per new word, with the exact column names of the tracking sheet.
export const toSheetRow=item=>({'Word':item.word,'Hindi Meaning':item.hindiMeaning,'English Meaning':item.englishMeaning,'Use Cases':item.useCases.join(' | ')});
