import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

// Applies pending prisma/migrations/*/migration.sql through the app's own database connection and records them in
// _prisma_migrations exactly like `prisma migrate deploy` does, so the CLI sees them as applied afterwards.
// Used on hosts where the migration engine cannot get the SQLite write lock but the app's connection (which waits for it) can.
export async function applyPendingMigrations(root='.'){
 const prisma=new PrismaClient();
 try{
  const base=join(root,'prisma','migrations');
  const names=readdirSync(base,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY NOT NULL,"checksum" VARCHAR(64) NOT NULL,"finished_at" DATETIME,"migration_name" VARCHAR(255) NOT NULL,"logs" TEXT,"rolled_back_at" DATETIME,"started_at" DATETIME NOT NULL DEFAULT current_timestamp,"applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)');
  const done=new Set((await prisma.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL')).map(row=>row.migration_name));
  const applied=[];
  for(const name of names){
   if(done.has(name))continue;
   const sql=readFileSync(join(base,name,'migration.sql'),'utf8');
   const statements=sql.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n').split(';').map(part=>part.trim()).filter(Boolean);
   const checksum=createHash('sha256').update(sql).digest('hex');
   await prisma.$transaction([
    ...statements.map(statement=>prisma.$executeRawUnsafe(statement)),
    prisma.$executeRawUnsafe('INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","applied_steps_count") VALUES (?,?,current_timestamp,?,1)',randomUUID(),checksum,name)
   ]);
   applied.push(name);
  }
  return applied;
 }finally{await prisma.$disconnect();}
}
