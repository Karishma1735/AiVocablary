import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Plug, Search, Unplug } from 'lucide-react';

const CONNECT_SCRIPT='https://flow.viasocket.com/connect.js';
function loadConnectScript(){
 if(typeof window.openViasocketConnection==='function')return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=CONNECT_SCRIPT;script.onload=resolve;
  script.onerror=()=>reject(Object.assign(new Error('The connect script could not load. Check your network or content blocker.'),{code:'script'}));
  document.head.appendChild(script);
 });
}
// Opens the app's own sign-in popup; resolves with the auth_id, or null if the user closed it.
function connectApp(embedToken,serviceId){
 return new Promise(async(resolve,reject)=>{
  await loadConnectScript().catch(reject);
  // The popup handle is not exposed, so a closed popup is detected only by timeout: nothing happened.
  const giveUp=setTimeout(()=>{window.removeEventListener('message',onMessage);resolve(null);},180000);
  const onMessage=event=>{
   if(event.data?.type!=='viasocket_connection_success')return;
   clearTimeout(giveUp);window.removeEventListener('message',onMessage);
   resolve(event.data?.data?.id||null);
  };
  window.addEventListener('message',onMessage);
  try{window.openViasocketConnection(embedToken,serviceId);}catch(error){window.removeEventListener('message',onMessage);reject(error);}
 });
}
function AppIcon({app,size=28}){return app.icon?<img src={app.icon} alt="" width={size} height={size} style={{borderRadius:6,objectFit:'contain'}}/>:<Plug size={size*0.7}/>;}

export default function IntegrationsPage({api}){
 const [status,setStatus]=useState(null);const [connections,setConnections]=useState([]);const [term,setTerm]=useState('');const [results,setResults]=useState([]);
 const [searching,setSearching]=useState(false);const [busy,setBusy]=useState('');const [error,setError]=useState('');const [message,setMessage]=useState('');
 const timer=useRef(null);
 async function loadConnections(){const result=await api('/api/integrations/connections');setConnections(result.connections);}
 useEffect(()=>{api('/api/integrations/status').then(setStatus).catch(e=>setError(e.message));loadConnections().catch(e=>setError(e.message));},[]);
 // The search is a type-ahead: an empty term returns nothing, so debounce and only call on input.
 useEffect(()=>{
  clearTimeout(timer.current);
  if(!term.trim()){setResults([]);return;}
  timer.current=setTimeout(async()=>{setSearching(true);try{setResults(await api('/api/integrations/search?q='+encodeURIComponent(term.trim())));}catch(e){setError(e.message);}finally{setSearching(false);}},350);
  return()=>clearTimeout(timer.current);
 },[term]);
 async function connect(app){
  setError('');setMessage('');setBusy(app.id);
  try{
   const token=await fetch('/api/integrations/token',{credentials:'same-origin'}).then(async r=>{if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'Could not start the connection.');return r.text();});
   const authId=await connectApp(token,app.id);
   if(!authId)return;
   await api('/api/integrations/connected',{method:'POST',body:JSON.stringify({serviceId:app.id,serviceName:app.name,authId})});
   await loadConnections();setMessage(app.name+' connected.');
  }catch(e){if(e?.code!=='closed')setError(e.message);}
  finally{setBusy('');}
 }
 async function disconnect(item){
  setError('');setMessage('');setBusy(item.serviceId);
  try{await api('/api/integrations/connections/'+encodeURIComponent(item.serviceId),{method:'DELETE'});await loadConnections();setMessage(item.serviceName+' disconnected.');}
  catch(e){setError(e.message);}finally{setBusy('');}
 }
 const connectedIds=new Set(connections.map(item=>item.serviceId));
 return <section className="page-section">
  <div className="page-intro"><span className="eyebrow">INTEGRATIONS</span><h2>Connect your apps</h2><p>Link the tools you already use. Your sign-in happens on the app's own page — we never see your password.</p></div>
  {status&&!status.configured&&<div className="notice error-notice">viaSocket is not configured on the server. Set VIASOCKET_ORG_ID, VIASOCKET_PROJECT_ID and VIASOCKET_EMBED_SECRET in .env.</div>}
  {error&&<div className="notice error-notice">{error}</div>}
  {message&&<div className="notice">{message}</div>}
  <h3>Connected apps</h3>
  {connections.length===0?<p className="muted">No apps connected yet.</p>:<ul style={{listStyle:'none',padding:0,display:'grid',gap:10}}>{connections.map(item=><li key={item.serviceId} style={{display:'flex',alignItems:'center',gap:12,justifyContent:'space-between'}}><b>{item.serviceName}</b><button className="secondary-button" disabled={busy===item.serviceId} onClick={()=>disconnect(item)}>{busy===item.serviceId?<LoaderCircle className="spin" size={15}/>:<Unplug size={15}/>} Disconnect</button></li>)}</ul>}
  <h3 style={{marginTop:24}}>Add an app</h3>
  <label style={{display:'flex',alignItems:'center',gap:8}}><Search size={16}/><input value={term} onChange={e=>setTerm(e.target.value)} placeholder="Search apps, e.g. Slack, Gmail, Google Sheets" style={{flex:1}}/>{searching&&<LoaderCircle className="spin" size={16}/>}</label>
  <ul style={{listStyle:'none',padding:0,display:'grid',gap:10,marginTop:12}}>{results.map(app=><li key={app.id} style={{display:'flex',alignItems:'center',gap:12,justifyContent:'space-between'}}><span style={{display:'flex',alignItems:'center',gap:10}}><AppIcon app={app}/><b>{app.name}</b></span>{connectedIds.has(app.id)?<span className="muted">Connected</span>:<button className="primary-button" disabled={busy===app.id||(status&&!status.configured)} onClick={()=>connect(app)}>{busy===app.id?<LoaderCircle className="spin" size={15}/>:<Plug size={15}/>} Connect</button>}</li>)}</ul>
 </section>;
}
