import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, dateKey, parseJsonArray } from './lib.js';

test('dateKey uses a stable UTC calendar date',()=>{assert.equal(dateKey(new Date('2026-10-10T23:30:00.000Z')),'2026-10-10');});
test('streak counts consecutive learning dates through today',()=>{assert.equal(computeStreak(['2026-10-10','2026-10-09','2026-10-08'],new Date('2026-10-10T10:00:00Z')),3);});
test('streak keeps yesterday active when today is not complete yet',()=>{assert.equal(computeStreak(['2026-10-09','2026-10-08'],new Date('2026-10-10T10:00:00Z')),2);});
test('streak stops at the first gap and handles no activity',()=>{assert.equal(computeStreak(['2026-10-10','2026-10-08'],new Date('2026-10-10T10:00:00Z')),1);assert.equal(computeStreak([],new Date('2026-10-10T10:00:00Z')),0);});
test('parseJsonArray accepts arrays and safely rejects invalid/non-array data',()=>{assert.deepEqual(parseJsonArray('["clear","brief"]'),['clear','brief']);assert.deepEqual(parseJsonArray('{"value":1}'),[]);assert.deepEqual(parseJsonArray('not json'),[]);});
