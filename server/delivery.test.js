import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep, collectBatch, buildEmail, toSheetRow, toEmailWord } from './delivery.js';

const run=(mode,count,cycle=1,times=1)=>Array.from({length:times},()=>({cycle,mode,count}));

test('first day is a new word in cycle 1',()=>{
 assert.deepEqual(nextStep([],0),{mode:'new',cycle:1,revisionStart:0});
});
test('stays on new words until 365 days are done',()=>{
 assert.equal(nextStep(run('new',1,1,364),364).mode,'new');
 assert.equal(nextStep(run('new',1,1,365),365).mode,'revision');
});
test('revision starts at 0 and advances by what was already revised',()=>{
 const logs=[...run('new',1,1,365),...run('revision',10,1,3)];
 assert.deepEqual(nextStep(logs,365),{mode:'revision',cycle:1,revisionStart:30});
});
test('revision covers all words, then a new cycle of new words begins',()=>{
 const almost=[...run('new',1,1,365),...run('revision',10,1,36)];
 assert.deepEqual(nextStep(almost,365),{mode:'revision',cycle:1,revisionStart:360});
 const done=[...almost,{cycle:1,mode:'revision',count:5}];
 assert.deepEqual(nextStep(done,365),{mode:'new',cycle:2,revisionStart:0});
});
test('second cycle: 365 more new days, then revision of all 730 words',()=>{
 const logs=[...run('new',1,1,365),...run('revision',10,1,36),{cycle:1,mode:'revision',count:5},...run('new',1,2,365)];
 const step=nextStep(logs,730);
 assert.equal(step.mode,'revision');assert.equal(step.cycle,2);assert.equal(step.revisionStart,0);
});

test('collectBatch never asks for more than one 200-row page at a time and handles a page boundary',async()=>{
 const rows=Array.from({length:500},(_,index)=>index);
 const calls=[];
 const fetchPage=async(offset,limit)=>{calls.push([offset,limit]);return rows.slice(offset,offset+limit);};
 const batch=await collectBatch(195,10,500,fetchPage);
 assert.deepEqual(batch,[195,196,197,198,199,200,201,202,203,204]);
 assert.deepEqual(calls,[[0,200],[200,200]]);
});
test('collectBatch inside one page makes a single call',async()=>{
 const rows=Array.from({length:500},(_,index)=>index);
 const calls=[];
 const batch=await collectBatch(30,10,500,async(offset,limit)=>{calls.push(offset);return rows.slice(offset,offset+limit);});
 assert.deepEqual(batch,[30,31,32,33,34,35,36,37,38,39]);assert.deepEqual(calls,[0]);
});
test('collectBatch stops at the end of the data',async()=>{
 const rows=Array.from({length:203},(_,index)=>index);
 const batch=await collectBatch(200,10,203,async(offset,limit)=>rows.slice(offset,offset+limit));
 assert.deepEqual(batch,[200,201,202]);
});
test('collectBatch can walk every word in 10-word steps without gaps or repeats',async()=>{
 const total=730;const rows=Array.from({length:total},(_,index)=>index);const seen=[];
 for(let start=0;start<total;start+=10)seen.push(...await collectBatch(start,10,total,async(offset,limit)=>rows.slice(offset,offset+limit)));
 assert.deepEqual(seen,rows);
});

test('email and sheet row carry word, Hindi and English meaning and use cases',()=>{
 const item=toEmailWord({word:'leverage',pronunciation:'LEV-er-ij',partOfSpeech:'verb',meaning:'To use something to get an advantage.',hindiMeaning:'फ़ायदा उठाना',examples:JSON.stringify(['We leverage case studies to win clients.','Leverage your network.'])});
 const email=buildEmail({mode:'new',words:[item],dayNumber:1});
 assert.match(email.subject,/leverage/);
 assert.match(email.text,/Hindi: फ़ायदा उठाना/);assert.match(email.html,/Use cases/);
 assert.deepEqual(toSheetRow(item),{'Word':'leverage','Hindi Meaning':'फ़ायदा उठाना','English Meaning':'To use something to get an advantage.','Use Cases':'We leverage case studies to win clients. | Leverage your network.'});
});
test('revision email lists all ten words',()=>{
 const words=Array.from({length:10},(_,index)=>toEmailWord({word:'w'+index,pronunciation:'',partOfSpeech:'noun',meaning:'m'+index,hindiMeaning:'h'+index,examples:'["u"]'}));
 const email=buildEmail({mode:'revision',words,dayNumber:400});
 assert.match(email.subject,/10 words/);assert.equal((email.text.match(/Hindi:/g)||[]).length,10);
});
