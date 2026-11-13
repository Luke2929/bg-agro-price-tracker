import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

const html=readFileSync(new URL('../site/v3.1/index.html',import.meta.url),'utf8');
const code=readFileSync(new URL('../site/v3.1/app.mjs',import.meta.url),'utf8');
const style=readFileSync(new URL('../site/v3.1/styles.css',import.meta.url),'utf8');
const legacyLanding=readFileSync(new URL('../site/v3/index.html',import.meta.url),'utf8');
const landing=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');

test('every dynamically referenced DOM id exists exactly once',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'Duplicate DOM ids');
  const referenced=[...code.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
  for(const id of referenced)assert.ok(ids.includes(id),`Missing DOM id: ${id}`);
});
test('all six V3.1 routes have a navigation target and screen',()=>{
  const expected=['overview','prices','history','watchlist','export','system'];
  for(const name of expected){
    assert.match(html,new RegExp(`data-screen="${name}"`));
    assert.match(html,new RegExp(`data-page="${name}"`));
  }
});
test('V3.1 uses modular local scripts, no CDN or external JavaScript dependencies',()=>{
  assert.match(html,/script type="module" src="\.\/app\.mjs"/);
  assert.doesNotMatch(html,/<script[^>]+https?:\/\//);
  assert.match(style,/@media\(max-width:790px\)/);
});
test('full raw CSV export is not labeled a summary and has all source columns',()=>{
  assert.match(html,/Full Raw Excel/);
  assert.match(html,/17 个 FAMA 原始字段/);
  assert.match(code,/summarizeRows\(records,store\.meta\.superseded_priceids/);
  assert.match(code,/const heads=raw\?FAMA_COLUMNS/);
});

test('history requests are sequenced to prevent stale async chart overwrites',()=>{
  assert.match(code,/const requestSequence=\+\+historyRequestSequence/);
  assert.match(code,/if\(requestSequence!==historyRequestSequence\)return/);
});
test('V3.1 product detail is a drill-down, not a seventh main navigation route',()=>{
  assert.match(html,/data-screen="product"/);
  assert.doesNotMatch(html,/data-page="product"/);
  for(const id of ['product-back','product-state','product-district','product-location',
    'product-level-cards','product-chart-level','product-chart-window','product-chart',
    'product-states-bars','product-raw-body','product-raw-more'])
    assert.match(html,new RegExp(`id="${id}"`));
  assert.match(code,/productAreaRows\(raw,/);
  assert.match(code,/drawChart\(points,start,end,\$\('product-chart'\)\)/);
});

test('root and legacy URLs redirect to V3.1; V3.1 has no old-version navigation',()=>{
  assert.match(landing,/http-equiv="refresh" content="0;url=\.\/v3\.1\/"/);
  assert.match(landing,/location\.replace\(new URL\('\.\/v3\.1\/'/);
  assert.match(legacyLanding,/http-equiv="refresh" content="0;url=\.\.\/v3\.1\/"/);
  assert.match(legacyLanding,/location\.replace\(new URL\('\.\.\/v3\.1\/'/);
  assert.doesNotMatch(html,/href="\.\.\/v3\/"/);
  assert.doesNotMatch(html,/legacy-link|返回 V3/);
  for(const page of [html]){
    assert.match(page,/class="brand-logo" src="\.\.\/assets\/agro-logo\.png"/);
    assert.match(page,/rel="icon" type="image\/png" href="\.\.\/assets\/agro-logo\.png"/);
    assert.doesNotMatch(page,/class="brand-mark"/);
  }
  assert.ok(statSync(new URL('../site/assets/agro-logo.png',import.meta.url)).size>1000);
});

test('price table has explicit 1/7/30-day ranking and clickable accessible change headers',()=>{
  for(const id of ['price-change-period','price-change-order'])
    assert.match(html,new RegExp('id="'+id+'"'));
  for(const period of [1,7,30])
    assert.match(html,new RegExp('data-price-period="'+period+'"'));
  for(const order of ['name','rise','fall','swing'])
    assert.match(html,new RegExp('<option value="'+order+'">'));
  assert.match(code,/sortQuotesByChange\(filtered,\{period,order\}\)/);
  assert.match(code,/btn\.closest\('th'\)\.setAttribute\('aria-sort'/);
  assert.match(style,/\.price-sort-toolbar/);
});

test('product-group mode defaults to one label per full product, keeping level-specific watch and sortable comparisons',()=>{
  assert.match(html,/id="price-display-mode"/);
  assert.match(html,/<option value="group" selected>合并同产品/);
  assert.match(html,/<option value="levels">逐层级显示/);
  assert.match(code,/groupQuotesByProduct\(filtered,\{period,order\}\)/);
  assert.match(code,/rowspan/,'groups must render product name as one spanning cell');
  assert.match(code,/group\.quotes\.forEach/,'each price level stays a distinct record');
  assert.match(code,/priceLevelCells\(quote\)/,'level-specific prices/changes are not averaged');
  assert.match(code,/data-watch-index=/,'each level preserves its watch star');
  assert.match(code,/store\.visible=40;renderPrices\(\)/,'filter changes reset pagination');
  assert.match(style,/\.price-level-ladang/);
  assert.match(style,/\.price-level-borong/);
  assert.match(style,/\.price-level-runcit/);
});


test('price explorer date selector recalculates historic matched-market comparison windows',()=>{
  assert.match(html,/id="price-date"/);
  assert.match(html,/id="price-date-latest"/);
  assert.match(html,/id="price-date-status"/);
  assert.match(code,/archiveComparisonDates\(store\.meta\.archive_dates,selected\)/);
  assert.match(code,/buildPriceDateSnapshot\(archive,/);
  assert.match(code,/store\.priceData=snapshot/);
  assert.match(code,/filterQuotes\(store\.priceData\.prices,filters\(\)\)/);
  assert.match(code,/store\.priceData\.survey_date/);
  assert.match(code,/loadPriceDate\(\)/);
  assert.match(code,/if\(sequence!==store\.priceDateRequest\)return/);
  assert.match(code,/store\.priceData\?\.prices\[Number\(btn\.dataset\.watchIndex\)\]/);
  assert.match(code,/selectOptions\(\$\('price-date'\),\[\.\.\.meta\.archive_dates\]\.reverse\(\)/);
  assert.match(style,/\.price-date-toolbar/);
});
