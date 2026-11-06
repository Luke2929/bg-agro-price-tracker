/* Shared V3 parity fixtures executed against the existing browser Algorithm V2. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'site/index.html'),'utf8');
const code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(x=>x[1]).find(text=>text.includes('BG Agro Algorithm V2'));
assert.ok(code,'Existing browser matched-market engine is required');
const context={window:{}};
vm.runInNewContext(code,context,{filename:'BGAgroCompare'});
const {MatchedMarketComparator,marketAverage,productKey}=context.window.BGAgroCompare;
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/market_math_v3.json'),'utf8'));
const row=o=>({
  tarikh_harga:o.date,negeri:o.state||'PERAK',daerah:'KINTA',lokasi:o.market,sublevel:'1',
  varieti:o.product||'KACANG BENDI',gred:o.grade||'A',unit:o.unit||'Kilogram',
  peringkat:o.level||'Runcit',harga:o.price
});

for(const fixture of fixtures.cases){
  test('shared matched-market fixture: '+fixture.name,()=>{
    const rows=fixture.observations.map(row);
    const actual=fixture.operation==='average' ? marketAverage(rows) :
      new MatchedMarketComparator(rows).compare(productKey(rows[0]),fixture.date,fixture.days,
        fixture.level||'Runcit',fixture.state||'PERAK');
    if(fixture.expected===null){assert.equal(actual,null);return;}
    assert.ok(actual);
    for(const [key,expected] of Object.entries(fixture.expected)){
      if(typeof expected==='number'){
        assert.ok(Math.abs(actual[key]-expected)<=1e-9,`${key}: ${actual[key]} != ${expected}`);
      }else{
        assert.equal(actual[key],expected,`${key} mismatch`);
      }
    }
  });
}
