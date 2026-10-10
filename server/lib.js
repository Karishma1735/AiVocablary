export const dateKey=(date=new Date())=>date.toISOString().slice(0,10);
export function parseJsonArray(value){try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}}
export function computeStreak(dates,today=new Date()){
 const active=new Set(dates);let cursor=new Date(dateKey(today)+'T00:00:00.000Z');
 if(!active.has(dateKey(cursor)))cursor.setUTCDate(cursor.getUTCDate()-1);
 let streak=0;while(active.has(dateKey(cursor))){streak++;cursor.setUTCDate(cursor.getUTCDate()-1);}return streak;
}
