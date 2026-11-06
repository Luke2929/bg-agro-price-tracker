import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

const html=readFileSync(new URL('../site/v3/index.html',import.meta.url),'utf8');
const code=readFileSync(new URL('../site/v3/app.mjs',import.meta.url),'utf8');
const style=readFileSync(new URL('../site/v3/styles.css',import.meta.url),'utf8');
const v31Html=readFileSync(new URL('../site/v3.1/index.html',import.meta.url),'utf8');
const v31Code=readFileSync(new URL('../site/v3.1/app.mjs',import.meta.url),'utf8');
const landing=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');

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
test('V3.1 product detail is a drill-down, not a seventh main navigation route',()=>{
  assert.doesNotMatch(html,/data-screen="product"/,'Live V3 must stay unchanged');
  assert.match(v31Html,/data-screen="product"/);
  assert.doesNotMatch(v31Html,/data-page="product"/);
  for(const id of ['product-back','product-state','product-district','product-location',
    'product-level-cards','product-chart-level','product-chart-window','product-chart',
    'product-states-bars','product-raw-body','product-raw-more'])
    assert.match(v31Html,new RegExp(`id="${id}"`));
  assert.match(v31Code,/productAreaRows\(raw,/);
  assert.match(v31Code,/drawChart\(points,start,end,\$\('product-chart'\)\)/);
});

test('classic landing is retired, V3 and V3.1 use the uploaded logo and favicon',()=>{
  assert.match(landing,/http-equiv="refresh" content="0;url=\.\/v3\/"/);
  assert.match(landing,/location\.replace\(new URL\('\.\/v3\/'/);
  for(const page of [html,v31Html]){
    assert.match(page,/class="brand-logo" src="\.\.\/assets\/agro-logo\.png"/);
    assert.match(page,/rel="icon" type="image\/png" href="\.\.\/assets\/agro-logo\.png"/);
    assert.doesNotMatch(page,/class="brand-mark"/);
  }
  assert.ok(statSync(new URL('../site/assets/agro-logo.png',import.meta.url)).size>1000);
  assert.match(html,/href="\.\.\/v3\.1\/"/);
});
