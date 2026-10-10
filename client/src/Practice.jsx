import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Dumbbell, LoaderCircle, Mic, MicOff, RefreshCw, Sparkles, Square, Trash2 } from 'lucide-react';

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

function Feedback({answer,feedback,onEdit,onNext}){
 const [showSample,setShowSample]=useState(false);
 return <div className="pr-results" aria-live="polite">
  <div className={'pr-summary '+(feedback.isAlreadyCorrect?'pr-summary-good':'')}><span className="pr-summary-icon">{feedback.isAlreadyCorrect?<Check size={18}/>:<Sparkles size={18}/>}</span><div><b>{feedback.isAlreadyCorrect?'Your answer is already correct.':'Here’s how to polish your answer.'}</b><p>{feedback.summary}</p></div></div>
  <div className="pr-panel"><span className="eyebrow">YOUR ORIGINAL ANSWER</span><p className="pr-text">{answer}</p></div>
  <div className="pr-versions">
   <div className="pr-panel pr-corrected"><span className="eyebrow">CORRECTED · GRAMMAR AND SPELLING ONLY</span><p className="pr-text">{feedback.isAlreadyCorrect?answer:feedback.correctedAnswer}</p></div>
   <div className="pr-panel pr-natural"><span className="eyebrow">MORE NATURAL · OPTIONAL STYLE</span><p className="pr-text">{feedback.professionalVersion}</p></div>
  </div>
  {feedback.mistakes.length>0&&<div className="pr-panel"><span className="eyebrow">WHAT CHANGED AND WHY</span><ul className="pr-list">{feedback.mistakes.map((item,i)=><Mistake key={i} item={item}/>)}</ul></div>}
  {feedback.vocabularySuggestions.length>0&&<div className="pr-panel"><span className="eyebrow">BETTER WORD CHOICES</span><ul className="pr-list">{feedback.vocabularySuggestions.map((item,i)=><li className="pr-vocab" key={i}><span className="chip">{item.word}</span><p>{item.suggestion}</p></li>)}</ul></div>}
  {feedback.sampleAnswer&&<div className="pr-panel"><button className="pr-toggle" aria-expanded={showSample} onClick={()=>setShowSample(!showSample)}><span className="eyebrow">SAMPLE ANSWER (OPTIONAL)</span><ChevronDown size={15} className={showSample?'pr-flip':''}/></button>{showSample&&<><p className="pr-text">{feedback.sampleAnswer}</p><p className="pr-note">This is only an example. Use your own real experience when you answer.</p></>}</div>}
  <div className="pr-actions"><button className="primary-button" onClick={onEdit}><RefreshCw size={15}/> Try again</button><button className="secondary-button" onClick={onNext}>Next question <ArrowRight size={14}/></button></div>
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
  <ul className="pr-list">{state.items.map(item=><li key={item.id} className="pr-history-item"><div className="pr-history-top"><span className="eyebrow">{item.categoryLabel.toUpperCase()} · {dateFormat.format(new Date(item.createdAt))}</span><button className="icon-button" aria-label="Delete this practice entry" onClick={()=>remove(item.id)}><Trash2 size={14}/></button></div><b>{item.question}</b><p className="pr-text">{item.answer}</p>{item.feedback&&<p className="pr-text pr-muted"><b>Corrected:</b> {item.feedback.correctedAnswer}</p>}</li>)}</ul>
 </div>;
}

export default function PracticePage({api}){
 const [meta,setMeta]=useState({categories:[],aiConfigured:true,loading:true,error:''});
 const [category,setCategory]=useState(null);
 const [qIndex,setQIndex]=useState(0);
 const [answer,setAnswer]=useState('');
 const [checking,setChecking]=useState(false);
 const [result,setResult]=useState(null);
 const [error,setError]=useState('');
 const [saveHistory,setSaveHistory]=useState(readPref);
 const [showHistory,setShowHistory]=useState(false);
 const [listening,setListening]=useState(false);
 const [interim,setInterim]=useState('');
 const [micError,setMicError]=useState('');
 const recognition=useRef(null);
 const requestId=useRef(0);
 const micSupported=Boolean(getRecognition());
 const secure=typeof window!=='undefined'&&window.isSecureContext;

 useEffect(()=>{let live=true;api('/api/practice/categories').then(data=>{if(live)setMeta({categories:data.categories,aiConfigured:data.aiConfigured,loading:false,error:''});}).catch(err=>{if(live)setMeta(m=>({...m,loading:false,error:err.message}));});return()=>{live=false;stopListening(true);};},[]);

 function stopListening(silent){const r=recognition.current;recognition.current=null;if(r){r.onend=null;r.onerror=null;r.onresult=null;try{r.abort();}catch{/* already stopped */}}if(!silent){setListening(false);setInterim('');}}
 function startListening(){
  const Recognition=getRecognition();
  if(!Recognition||!secure){setMicError(!Recognition?'This browser doesn’t support speech recognition. Please type your answer.':'Microphone input needs a secure (https) connection. Please type your answer.');return;}
  setMicError('');
  const r=new Recognition();r.lang='en-IN';r.continuous=true;r.interimResults=true;
  r.onresult=event=>{let finalText='',temp='';for(let i=event.resultIndex;i<event.results.length;i++){const piece=event.results[i][0].transcript;if(event.results[i].isFinal)finalText+=piece;else temp+=piece;}if(finalText)setAnswer(prev=>(prev&&!/\s$/.test(prev)?prev+' ':prev)+finalText.trim());setInterim(temp);};
  r.onerror=event=>{if(event.error==='aborted')return;setMicError(micMessages[event.error]||'Speech recognition stopped unexpectedly. You can keep typing your answer.');};
  r.onend=()=>{recognition.current=null;setListening(false);setInterim('');};
  recognition.current=r;
  try{r.start();setListening(true);}catch{recognition.current=null;setMicError('Couldn’t start the microphone. Please try again or type your answer.');}
 }
 function reset(nextCategory,index){stopListening();requestId.current++;setCategory(nextCategory);setQIndex(index);setAnswer('');setResult(null);setError('');setMicError('');setChecking(false);}
 function toggleSave(value){setSaveHistory(value);writePref(value);}
 async function check(){
  stopListening();
  if(!answer.trim()){setError('Please type or speak an answer first.');return;}
  const id=++requestId.current;setChecking(true);setError('');setResult(null);
  try{const data=await api('/api/practice/check',{method:'POST',body:JSON.stringify({category:category.id,question:category.questions[qIndex],answer:answer.trim(),saveHistory})});if(id===requestId.current)setResult(data);}
  catch(err){if(id===requestId.current)setError(err.message);}
  finally{if(id===requestId.current)setChecking(false);}
 }
 const editAgain=()=>{setResult(null);setError('');};

 if(meta.loading)return <section className="page-section"><div className="empty-inline"><LoaderCircle className="spin" size={16}/> Loading practice…</div></section>;
 if(!category)return <section className="page-section"><div className="page-intro"><span className="eyebrow">PRACTICE & IMPROVE</span><h2>Say it better.</h2><p>Pick a topic, answer in your own words, and get gentle corrections and more natural phrasing.</p></div>
  {meta.error&&<div className="notice error-notice" role="alert"><CircleHelp size={16}/>{meta.error}</div>}
  {!meta.aiConfigured&&<div className="notice"><CircleHelp size={16}/> AI feedback isn’t set up yet, so “Check my answer” is unavailable. You can still browse the questions and draft answers.</div>}
  <div className="pr-grid">{meta.categories.map(item=><button className="pr-category" key={item.id} onClick={()=>reset(item,0)}><span className="pr-category-icon"><Dumbbell size={18}/></span><span><b>{item.label}</b><small>{item.description}</small></span><ArrowRight size={16}/></button>)}</div>
  <div className="pr-toolbar"><button className="secondary-button" onClick={()=>setShowHistory(!showHistory)} aria-expanded={showHistory}>{showHistory?'Hide':'View'} practice history</button></div>
  {showHistory&&<History api={api} onClose={()=>setShowHistory(false)}/>}
 </section>;

 const question=category.questions[qIndex];
 return <section className="page-section pr-session">
  <button className="text-link pr-back" onClick={()=>reset(null,0)}><ArrowLeft size={14}/> All topics</button>
  <div className="pr-panel pr-question"><div className="pr-question-top"><span className="today-pill"><Dumbbell size={13}/> {category.label.toUpperCase()}</span><span className="pr-count">Question {qIndex+1} of {category.questions.length}</span></div><h2 id="pr-question">{question}</h2></div>
  {!meta.aiConfigured&&<div className="notice"><CircleHelp size={16}/> AI feedback isn’t set up yet, so your answer can’t be checked right now.</div>}
  {!result&&<div className="pr-panel">
   <label className="pr-label" htmlFor="pr-answer">Your answer</label>
   <textarea id="pr-answer" className="pr-textarea" rows={7} maxLength={2000} aria-describedby="pr-help" placeholder="Type your answer here, or use the microphone and edit the text afterwards." value={answer} onChange={event=>setAnswer(event.target.value)} disabled={checking}/>
   {interim&&<p className="pr-interim" aria-live="off">Hearing: {interim}</p>}
   <div className="pr-input-row">
    {micSupported?<button type="button" className={'secondary-button pr-mic '+(listening?'pr-mic-on':'')} aria-pressed={listening} onClick={listening?()=>stopListening():startListening} disabled={checking}>{listening?<><Square size={14}/> Stop listening</>:<><Mic size={15}/> Speak your answer</>}</button>:<span className="pr-mic-off"><MicOff size={15}/> Microphone input isn’t supported in this browser — please type your answer. Chrome, Edge or Safari usually work.</span>}
    <span className="pr-counter">{answer.length}/2000</span>
   </div>
   <div role="status" className="pr-status">{listening&&<span className="pr-listening"><i/> Listening… speak now, then press Stop. Your words appear above and you can edit them.</span>}</div>
   {micError&&<div className="form-error" role="alert">{micError}</div>}
   <p id="pr-help" className="pr-note">{micSupported?'Speech is converted to text by your browser’s speech service, which may send audio to its provider. VocabRise never records or stores audio — only the text you submit is sent to us.':'Only the text you type is sent to VocabRise.'}</p>
   <label className="pr-check"><input type="checkbox" checked={saveHistory} onChange={event=>toggleSave(event.target.checked)}/> Save my practice (answer and feedback) to my private history</label>
   {error&&<div className="form-error" role="alert">{error}</div>}
   <div className="pr-actions"><button className="primary-button" onClick={check} disabled={checking||!answer.trim()||!meta.aiConfigured}>{checking?<><LoaderCircle className="spin" size={16}/> Checking your answer…</>:<>Check my answer <ArrowRight size={15}/></>}</button><button className="secondary-button" onClick={()=>reset(category,(qIndex+1)%category.questions.length)} disabled={checking}>Next question</button></div>
  </div>}
  {result&&!result.feedback&&<div className="pr-panel"><div className="notice" role="status"><CircleHelp size={16}/>{result.message}</div><div className="pr-actions"><button className="secondary-button" onClick={editAgain}>Back to my answer</button></div></div>}
  {result?.feedback&&<Feedback answer={answer.trim()} feedback={result.feedback} onEdit={editAgain} onNext={()=>reset(category,(qIndex+1)%category.questions.length)}/>}
  {result?.saved&&<p className="pr-note pr-saved"><Check size={13}/> Saved to your private practice history.</p>}
 </section>;
}
