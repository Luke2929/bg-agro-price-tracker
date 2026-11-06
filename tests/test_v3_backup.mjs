import test from 'node:test';
import assert from 'node:assert/strict';
import {decideRecovery} from '../ops/cloudflare-backup/src/index.mjs';

const now=Date.parse('2026-11-06T08:55:00Z');
const minutesAgo=minutes=>new Date(now-minutes*60000).toISOString();

test('fresh completed success blocks fallback dispatch',()=>{
  assert.equal(decideRecovery([{created_at:minutesAgo(75),status:'completed',conclusion:'success',event:'schedule'}],now).dispatch,false);
});
test('missed schedule with stale successful run activates fallback',()=>{
  const result=decideRecovery([{created_at:minutesAgo(200),status:'completed',conclusion:'success',event:'schedule'}],now);
  assert.equal(result.dispatch,true);
});
test('queued and running GitHub workflows block duplicate dispatch',()=>{
  for(const status of ['queued','in_progress','waiting']){
    assert.equal(decideRecovery([
      {created_at:minutesAgo(180),status:'completed',conclusion:'success',event:'schedule'},
      {created_at:minutesAgo(15),status,conclusion:null,event:'schedule'}
    ],now).dispatch,false);
  }
});
test('recent manual backup call blocks duplicate dispatch even if failed',()=>{
  const result=decideRecovery([{created_at:minutesAgo(30),status:'completed',conclusion:'failure',event:'workflow_dispatch'}],now);
  assert.equal(result.dispatch,false);
});
test('missing or invalid run API is handled conservatively',()=>{
  assert.equal(decideRecovery(null,now).dispatch,false);
  assert.equal(decideRecovery([],now).dispatch,true);
});
