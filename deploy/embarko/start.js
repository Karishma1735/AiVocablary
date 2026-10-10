import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
let state=readState();
console.log('Startup state:',JSON.stringify(state));
if(!state.migrated&&!run('npx',['prisma','migrate','deploy']))state.migrated=false;
else if(!state.migrated)state.migrated=true;
if(!state.seeded&&!run(process.execPath,['prisma/seed.js']))console.error('Seeding deferred.');
await import('../server/index.js');
if(!state.migrated){
 let tries=0;
 const timer=setInterval(()=>{
  tries++;
  const child=spawn('npx',['prisma','migrate','deploy'],{stdio:'inherit',env:process.env});
  child.on('exit',code=>{if(code===0){console.log('Migrations applied in the background.');clearInterval(timer);}else if(tries>=40){console.error('Giving up on background migration.');clearInterval(timer);}});
 },30000);
}
