import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleHelp, Dumbbell, LoaderCircle, Mic, MicOff, RefreshCw, Send, Sparkles, Square, Trash2 } from 'lucide-react';


const HISTORY_PREF='vocabrise_practice_history';
const dateFormat=new Intl.DateTimeFormat('en-IN',{month:'short',day:'numeric'});
const getRecognition=()=>typeof window==='undefined'?null:(window.SpeechRecognition||window.webkitSpeechRecognition||null);
function readPref(){try{return localStorage.getItem(HISTORY_PREF)!=='off';}catch{return true;}}
function writePref(value){try{localStorage.setItem(HISTORY_PREF,value?'on':'off');}catch{/* preference just won't persist */}}
const micMessages={'not-allowed':'Microphone access was blocked. Allow it in your browser’s site settings, or type your answer instead.','service-not-allowed':'Microphone access was blocked. Allow it in your browser’s site settings, or type your answer instead.','no-speech':'We didn’t hear anything. Check your microphone and try again, or type your answer.','audio-capture':'No working microphone was found. Connect one, or type your answer.',network:'Speech recognition needs an internet connection in this browser. You can still type your answer.','language-not-supported':'This browser can’t recognise English speech. Please type your answer.'};

function Mistake({item}){
 const isStyle=item.type==='style'||item.type==='vocabulary';
 return <li className="pr-mistake"><span className={'pr-tag '+(isStyle?'pr-tag-optional':'pr-tag-fix')}>{isStyle?'Optional '+item.type:item.type+' fix'}</span><div className="pr-change"><s>{item.original}</s><ArrowRight size={13} aria-hidden="true"/><b>{item.correction}</b></div><p>{item.explanation}</p></li>;
}

function Bubble({role,children}){
 return <div className={'pr-msg pr-msg-'+role}><span className="pr-avatar" aria-hidden="true">{role==='ai'?<Sparkles size={14}/>:'You'}</span><div className="pr-bubble">{children}</div></div>;
}

function Correction({answer,feedback}){
 const same=feedback.isAlreadyCorrect;
 return <div className="pr-correction">
  <span className="eyebrow">{same?'NICELY DONE — NOTHING TO FIX':'CORRECTED VERSION'}</span>
  <p className="pr-text pr-corrected-text">{same?answer:feedback.correctedAnswer}</p>
  {feedback.summary&&<p className="pr-note">{feedback.summary}</p>}
  {feedback.professionalVersion&&feedback.professionalVersion!==(same?answer:feedback.correctedAnswer)&&<><span className="eyebrow pr-gap">MORE NATURAL (OPTIONAL)</span><p className="pr-text">{feedback.professionalVersion}</p></>}
  {feedback.mistakes.length>0&&<><span className="eyebrow pr-gap">WHAT CHANGED AND WHY</span><ul className="pr-list">{feedback.mistakes.map((item,i)=><Mistake key={i} item={item}/>)}</ul></>}
 </div>;
}

function History({api,onClose}){
 const [state,setState]=useState({loading:true,error:'',items:[]});
 async function load(){try{const data=await api('/api/practice/history');setState({loading:false,error:'',items:data.sessions});}catch(error){setState({loading:false,error:error.message,items:[]});}}
 useEffect(()=>{load();},[]);
 async function remove(id){try{await api('/api/practice/history/'+id,{method:'DELETE'});setState(s=>({...s,items:s.items.filter(item=>item.id!==id)}));}catch(error){setState(s=>({...s,error:error.message}));}}
 async function clearAll(){if(!window.confirm('Delete all of your saved practice history?'))return;try{await api('/api/practice/history',{method:'DELETE'});setState(s=>({...s,items:[]}));}catch(error){setState(s=>({...s,error:error.message}));}}
 return <div className="pr-panel pr-history"><div className="card-head"><div><span className="eyebrow">ONLY VISIBLE TO YOU</span><h3>Practice history</h3></div><div className="pr-head-actions">{state.items.length>0&&<button className="secondary-button" onClick={clearAll}><Trash2 size={14}/> Clear all</button>}<button className="secondary-button" onClick={onClose}>Close</button></div></div>
  {state.loading&&<div className="empty-inline"><LoaderCircle className="spin" size={16}/> Loading your history…</div>}
  {state.error&&<div className="form-error" role="alert">{state.error}</div>}
  {!state.loading&&!state.error&&!state.items.length&&<div className="empty-inline"><Dumbbell size={17}/> No saved practice yet. Check an answer with “Save my practice” turned on.</div>}
  <ul className="pr-list">{state.items.map(item=><li key={item.id} className="pr-history-item"><div className="pr-history-top"><span className="eyebrow">AI CONVERSATION · {dateFormat.format(new Date(item.createdAt))}</span><button className="icon-button" aria-label="Delete this practice entry" onClick={()=>remove(item.id)}><Trash2 size={14}/></button></div><b>{item.question}</b><p className="pr-text">{item.answer}</p>{item.feedback&&<p className="pr-text pr-muted"><b>Corrected:</b> {item.feedback.correctedAnswer}</p>}</li>)}</ul>
 </div>;
}

export default function PracticePage({api}){
 const [meta,setMeta]=useState({aiConfigured:true,loading:true,error:''});
 const [thread,setThread]=useState([]);
 const [input,setInput]=useState('');
 const [asking,setAsking]=useState(false);
 const [checking,setChecking]=useState(false);
 const [error,setError]=useState('');
 const [saveHistory,setSaveHistory]=useState(readPref);
 const [showHistory,setShowHistory]=useState(false);
 const [listening,setListening]=useState(false);
 const [interim,setInterim]=useState('');
 const [micError,setMicError]=useState('');
 const recognition=useRef(null);
 const requestId=useRef(0);
 const endRef=useRef(null);
 const threadRef=useRef([]);
 const micSupported=Boolean(getRecognition());
 const secure=typeof window!=='undefined'&&window.isSecureContext;
 const current=[...thread].reverse().find(m=>m.kind==='question');
 const waitingForAnswer=Boolean(current)&&thread[thread.length-1]===current;

 const push=message=>{threadRef.current=[...threadRef.current,message];setThread(threadRef.current);};
 useEffect(()=>{let live=true;api('/api/practice/config').then(data=>{if(!live)return;setMeta({aiConfigured:data.aiConfigured,loading:false,error:''});if(data.aiConfigured)askQuestion();}).catch(err=>{if(live)setMeta(m=>({...m,loading:false,error:err.message}));});return()=>{live=false;requestId.current++;stopListening(true);};},[]);
 useEffect(()=>{endRef.current?.scrollIntoView?.({behavior:'smooth',block:'end'});},[thread,asking,checking]);

 async function askQuestion(){
  const id=++requestId.current;setAsking(true);setError('');
  const recent=threadRef.current.filter(m=>m.kind==='question').slice(-10).map(m=>m.text);
  try{const data=await api('/api/practice/question',{method:'POST',body:JSON.stringify({recent})});if(id!==requestId.current)return;if(data.question)push({role:'ai',kind:'question',text:data.question});else setError(data.message||'Could not get a question.');}
  catch(err){if(id===requestId.current)setError(err.message);}
  finally{if(id===requestId.current)setAsking(false);}
 }
 function stopListening(silent){const r=recognition.current;recognition.current=null;if(r){r.onend=null;r.onerror=null;r.onresult=null;try{r.abort();}catch{/* already stopped */}}if(!silent){setListening(false);setInterim('');}}
 function startListening(){
  const Recognition=getRecognition();
  if(!Recognition||!secure){setMicError(!Recognition?'This browser doesn’t support speech recognition. Please type your answer.':'Microphone input needs a secure (https) connection. Please type your answer.');return;}
  setMicError('');
  const r=new Recognition();r.lang='en-IN';r.continuous=true;r.interimResults=true;
  r.onresult=event=>{let finalText='',temp='';for(let i=event.resultIndex;i<event.results.length;i++){const piece=event.results[i][0].transcript;if(event.results[i].isFinal)finalText+=piece;else temp+=piece;}if(finalText)setInput(prev=>(prev&&!/\s$/.test(prev)?prev+' ':prev)+finalText.trim());setInterim(temp);};
  r.onerror=event=>{if(event.error==='aborted')return;setMicError(micMessages[event.error]||'Speech recognition stopped unexpectedly. You can keep typing your answer.');};
  r.onend=()=>{recognition.current=null;setListening(false);setInterim('');};
  recognition.current=r;
  try{r.start();setListening(true);}catch{recognition.current=null;setMicError('Couldn’t start the microphone. Please try again or type your answer.');}
 }
 function toggleSave(value){setSaveHistory(value);writePref(value);}
 async function send(){
  stopListening();
  const answer=input.trim();
  if(!answer){setError('Please type or speak an answer first.');return;}
  if(!waitingForAnswer||checking)return;
  const id=++requestId.current;
  push({role:'user',kind:'answer',text:answer});setInput('');setChecking(true);setError('');setMicError('');
  try{
   const data=await api('/api/practice/check',{method:'POST',body:JSON.stringify({question:current.text,answer,saveHistory})});
   if(id!==requestId.current)return;
   if(data.feedback){push({role:'ai',kind:'feedback',answer,feedback:data.feedback});setChecking(false);askQuestion();return;}
   push({role:'ai',kind:'notice',text:data.message||'Feedback is not available right now.'});
  }catch(err){
   if(id!==requestId.current)return;
   push({role:'ai',kind:'notice',text:err.message,retry:answer});
  }
  setChecking(false);
 }
 function retry(answer){threadRef.current=threadRef.current.filter(m=>m.kind!=='notice');setThread(threadRef.current);const last=threadRef.current[threadRef.current.length-1];if(last?.kind==='answer'){threadRef.current=threadRef.current.slice(0,-1);setThread(threadRef.current);}setInput(answer);}
 function restart(){stopListening();requestId.current++;threadRef.current=[];setThread([]);setInput('');setError('');setMicError('');setChecking(false);setAsking(false);askQuestion();}

 if(meta.loading)return <section className="page-section"><div className="empty-inline"><LoaderCircle className="spin" size={16}/> Loading practice…</div></section>;
 return <section className="page-section pr-session">
  <div className="page-intro"><span className="eyebrow">PRACTICE & IMPROVE</span><h2>Just talk it through.</h2><p>The AI asks you a question. Answer by voice or text, and it will show you a corrected version.</p></div>
  {meta.error&&<div className="notice error-notice" role="alert"><CircleHelp size={16}/>{meta.error}</div>}
  {!meta.aiConfigured&&<div className="notice"><CircleHelp size={16}/> The AI conversation isn’t set up yet. Ask the app owner to add a Gemini API key on the server.</div>}
  {meta.aiConfigured&&<>
  <div className="pr-chat" aria-live="polite">
   {thread.map((m,i)=>m.kind==='question'?<Bubble key={i} role="ai"><p className="pr-text pr-q">{m.text}</p></Bubble>
    :m.kind==='answer'?<Bubble key={i} role="user"><p className="pr-text">{m.text}</p></Bubble>
    :m.kind==='feedback'?<Bubble key={i} role="ai"><Correction answer={m.answer} feedback={m.feedback}/></Bubble>
    :<Bubble key={i} role="ai"><p className="pr-text">{m.text}</p>{m.retry&&<button className="secondary-button pr-retry" onClick={()=>retry(m.retry)}><RefreshCw size={13}/> Edit and try again</button>}</Bubble>)}
   {(asking||checking)&&<Bubble role="ai"><span className="pr-typing"><LoaderCircle className="spin" size={14}/> {checking?'Checking your answer…':'Thinking of a question…'}</span></Bubble>}
   {!asking&&!checking&&!waitingForAnswer&&error&&<Bubble role="ai"><p className="pr-text">{error}</p><button className="secondary-button pr-retry" onClick={askQuestion}><RefreshCw size={13}/> Try again</button></Bubble>}
   <div ref={endRef}/>
  </div>
  <div className="pr-panel pr-composer">
   <textarea id="pr-answer" className="pr-textarea" aria-label="Your answer" rows={3} maxLength={2000} placeholder={waitingForAnswer?'Type your answer, or tap the microphone and speak…':'Waiting for the next question…'} value={input} onChange={event=>setInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();}}} disabled={!waitingForAnswer||checking}/>
   {interim&&<p className="pr-interim" aria-live="off">Hearing: {interim}</p>}
   <div className="pr-input-row">
    {micSupported?<button type="button" className={'secondary-button pr-mic '+(listening?'pr-mic-on':'')} aria-pressed={listening} onClick={listening?()=>stopListening():startListening} disabled={!waitingForAnswer||checking}>{listening?<><Square size={14}/> Stop listening</>:<><Mic size={15}/> Speak</>}</button>:<span className="pr-mic-off"><MicOff size={15}/> Microphone input isn’t supported in this browser — please type. Chrome, Edge or Safari usually work.</span>}
    <span className="pr-counter">{input.length}/2000</span>
    <button className="primary-button pr-send" onClick={send} disabled={!waitingForAnswer||checking||!input.trim()}><Send size={15}/> Send</button>
   </div>
   <div role="status" className="pr-status">{listening&&<span className="pr-listening"><i/> Listening… speak, then press Stop. You can edit the text before sending.</span>}</div>
   {micError&&<div className="form-error" role="alert">{micError}</div>}
   {error&&waitingForAnswer&&<div className="form-error" role="alert">{error}</div>}
   <p className="pr-note">{micSupported?'Speech is converted to text by your browser’s speech service, which may send audio to its provider. VocabRise never records or stores audio — only the text you send reaches us.':'Only the text you type is sent to VocabRise.'}</p>
   <label className="pr-check"><input type="checkbox" checked={saveHistory} onChange={event=>toggleSave(event.target.checked)}/> Save my practice (answer and feedback) to my private history</label>
   <div className="pr-actions"><button className="secondary-button" onClick={askQuestion} disabled={asking||checking||!waitingForAnswer}>Skip — ask me something else</button><button className="secondary-button" onClick={restart} disabled={asking||checking}>Start over</button></div>
  </div>
  </>}
  <div className="pr-toolbar"><button className="secondary-button" onClick={()=>setShowHistory(!showHistory)} aria-expanded={showHistory}>{showHistory?'Hide':'View'} practice history</button></div>
  {showHistory&&<History api={api} onClose={()=>setShowHistory(false)}/>}
 </section>;
}
