import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../site/v3/index.html',import.meta.url),'utf8');
const code=readFileSync(new URL('../site/v3/app.mjs',import.meta.url),'utf8');
const style=readFileSync(new URL('../site/v3/styles.css',import.meta.url),'utf8');

test('every dynamically referenced DOM id exists exactly once',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'Duplicate DOM ids');
  const referenced=[...code.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
  for(const id of referenced)assert.ok(ids.includes(id),`Missing DOM id: ${id}`);
});
test('all six V3 routes have a navigation target and screen',()=>{
  const expected=['overview','prices','history','watchlist','export','system'];
  for(const name of expected){
    assert.match(html,new RegExp(`data-screen="${name}"`));
    assert.match(html,new RegExp(`data-page="${name}"`));
  }
});
test('V3 uses modular local scripts, no CDN or external JavaScript dependencies',()=>{
  assert.match(html,/script type="module" src="\.\/app\.mjs"/);
  assert.doesNotMatch(html,/<script[^>]+https?:\/\//);
  assert.match(style,/@media\(max-width:790px\)/);
});
test('full raw CSV export is not labeled a summary and has all source columns',()=>{
  assert.match(html,/Full Raw Data/);
  assert.match(html,/17 个 FAMA 原始字段/);
  assert.match(code,/summarizeRows\(records,store\.meta\.superseded_priceids/);
  assert.match(code,/const heads=raw\?FAMA_COLUMNS/);
});

test('history requests are sequenced to prevent stale async chart overwrites',()=>{
  assert.match(code,/const requestSequence=\+\+historyRequestSequence/);
  assert.match(code,/if\(requestSequence!==historyRequestSequence\)return/);
});
