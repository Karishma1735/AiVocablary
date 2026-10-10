import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyPendingMigrations } from './migrate-inprocess.js';
// Embarko start script: keeps the SQLite file under DATA_DIR (it survives redeploys) and applies migrations
// without ever blocking startup. During a redeploy the old instance can still hold the database lock, so
// a failed migration is retried in the background until the old instance is gone.
const dir=process.env.DATA_DIR||'.';
mkdirSync(dir,{recursive:true});
process.env.DATABASE_URL='file:'+join(dir,'vocabrise.db')+'?socket_timeout=30&connection_limit=1';
process.env.NODE_ENV=process.env.NODE_ENV||'production';
const probe=`import {PrismaClient} from '@prisma/client';import {readdirSync} from 'node:fs';
const p=new PrismaClient();const dirs=readdirSync('prisma/migrations',{withFileTypes:true}).filter(d=>d.isDirectory()).length;
let out={migrated:false,seeded:false};
try{const rows=await p.$queryRawUnsafe('SELECT COUNT(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL');out.migrated=Number(rows[0].n)>=dirs;out.seeded=(await p.vocabularyWord.count({where:{source:'seed'}}))>0;}catch{}
await p.$disconnect();console.log('STATE '+JSON.stringify(out));`;
const readState=()=>{const r=spawnSync(process.execPath,['--input-type=module','-e',probe],{encoding:'utf8',env:process.env});const m=/STATE (\{.*\})/.exec(r.stdout||'');return m?JSON.parse(m[1]):{migrated:false,seeded:false};};
const run=(cmd,args)=>spawnSync(cmd,args,{stdio:'inherit',env:process.env}).status===0;
const state=readState();
console.log('Startup state:',JSON.stringify(state));
// Seed only when the database is empty (a no-op otherwise); a failure here must not stop the app.
if(!state.seeded&&spawnSync(process.execPath,['prisma/seed.js'],{stdio:'inherit',env:process.env}).status!==0)console.error('Seeding deferred.');
await import('./index.js');
// Migrations run through the app's own connection after the server is up, retrying until the database is free.
if(!state.migrated){
 let tries=0;
 const attempt=async()=>{
  tries++;
  try{const applied=await applyPendingMigrations('.');console.log('Migrations applied:',applied.length?applied.join(', '):'none pending');return;}
  catch(error){console.error('Migration attempt '+tries+' failed:',error?.message||error);}
  if(tries<40)setTimeout(attempt,15000);else console.error('Giving up on migrations.');
 };
 attempt();
}
