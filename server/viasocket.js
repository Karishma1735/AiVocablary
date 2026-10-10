import { ViaSocket } from 'viasocket-apps';
const SEARCH_URL='https://flow.sokt.io/func/scri12BSufQM';
export function isViaSocketConfigured(){return Boolean(process.env['VIASOCKET_ORG_ID']&&process.env['VIASOCKET_PROJECT_ID']&&process.env['VIASOCKET_EMBED_SECRET']);}
let client=null;
function getClient(){
 if(!isViaSocketConfigured())throw Object.assign(new Error('viaSocket is not configured. Set VIASOCKET_ORG_ID, VIASOCKET_PROJECT_ID and VIASOCKET_EMBED_SECRET.'),{status:503});
 client??=new ViaSocket({orgId:process.env['VIASOCKET_ORG_ID'],projectId:process.env['VIASOCKET_PROJECT_ID'],secret:process.env['VIASOCKET_EMBED_SECRET']});
 return client;
}
// unique_identifier is our own user id, one per user, forever.
export const viaUser=userId=>getClient().user(userId);
export const embedToken=userId=>viaUser(userId).token();
export async function searchApps(term){
 const key=String(term||'').trim().slice(0,80);
 if(!key)return [];
 const response=await fetch(SEARCH_URL+'?key='+encodeURIComponent(key));
 if(!response.ok)throw Object.assign(new Error('App search is unavailable right now.'),{status:502});
 const body=await response.json();
 return (body.data||[]).map(app=>({id:app.service_id,name:app.name,icon:app.iconurl||null}));
}
export const listConnections=userId=>viaUser(userId).listConnections();
export const revokeConnection=(userId,authId)=>viaUser(userId).revokeConnection(authId);
export const enableConnection=async(userId,serviceId,authId)=>{const user=viaUser(userId);return (await user.findEnabled(serviceId))??(await user.enable(serviceId,authId)).scriptId;};
