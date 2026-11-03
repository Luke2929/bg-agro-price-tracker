'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

const html=fs.readFileSync(path.join(__dirname,'..','site','index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
const compareScript=scripts.find(x=>x.includes('BG Agro Algorithm V2'));
const archiveScript=scripts.find(x=>x.includes('Fetch original FAMA daily CSVs'));
assert.ok(compareScript,'Algorithm V2 comparison module must exist');
assert.ok(archiveScript,'Archive loader module must exist');
const context={window:{},setTimeout};
vm.runInNewContext(compareScript,context,{filename:'BGAgroCompare'});
vm.runInNewContext(archiveScript,context,{filename:'BGAgroArchive'});
const {MatchedMarketComparator,productKey,marketAverage}=context.window.BGAgroCompare;
const {ArchiveLoader}=context.window.BGAgroArchive;
const row=(date,market,price,{state='PERAK',grade='A',level='Runcit',unit='Kilogram'}={})=>({
  tarikh_harga:date,negeri:state,daerah:'KINTA',lokasi:market,sublevel:'1',
  varieti:'KACANG BENDI',gred:grade,unit,peringkat:level,harga:String(price)
});
const cmp=(rows,days=1,opts={})=>{
  const c=new MatchedMarketComparator(rows);
  return c.compare(productKey(rows[0]),'2026-11-02',days,opts.level||'Runcit',opts.state||'PERAK');
};

test('all four embedded browser scripts parse without syntax errors',()=>{
  assert.equal(scripts.length,4);
  for(const code of scripts)assert.doesNotThrow(()=>new vm.Script(code));
});
test('equal-weight market average is not distorted by duplicate rows',()=>{
  const values=[row('2026-11-02','A',4),row('2026-11-02','A',6),row('2026-11-02','B',10)];
  const result=marketAverage(values);
  assert.equal(result.mean,7.5); // (mean(A)=5 + mean(B)=10) / 2
  assert.equal(result.n,3);
  assert.equal(result.markets,2);
  assert.equal(marketAverage([row('2026-11-02','A','')]),null);
});
test('1D skips a non-overlapping calendar yesterday, exposes the true baseline',()=>{
  const rows=[row('2026-11-02','A',6),row('2026-11-02','B',10),row('2026-11-01','OTHER',100),row('2026-10-31','A',4),row('2026-10-31','B',8)];
  const change=cmp(rows);
  assert.equal(change.previousDate,'2026-10-31');
  assert.equal(change.actualDays,2);
  assert.equal(change.current,8);
  assert.equal(change.previous,6);
  assert.ok(Math.abs(change.percent-33.33333333333333)<1e-9);
  assert.equal(change.eligible,false);
});
test('1D shows unavailable when the comparable history is older than seven days',()=>{
  assert.equal(cmp([row('2026-11-02','A',10),row('2026-10-25','A',5)]),null);
});
test('7D and 30D use on-or-before targets with bounded staleness',()=>{
  const rows=[row('2026-11-02','A',20),row('2026-10-26','A',10),row('2026-10-03','A',8)];
  assert.equal(cmp(rows,7).previousDate,'2026-10-26');
  assert.equal(cmp(rows,30).previousDate,'2026-10-03');
  assert.equal(cmp([row('2026-11-02','A',20),row('2026-10-25','A',10)],7).previousDate,'2026-10-25');
  assert.equal(cmp([row('2026-11-02','A',20),row('2026-10-21','A',10)],7),null);
  assert.equal(cmp([row('2026-11-02','A',20),row('2026-09-25','A',10)],30),null);
});
test('grade, unit, market and state never cross-match',()=>{
  const rows=[row('2026-11-02','A',8),row('2026-11-01','A',2,{grade:'B'}),row('2026-11-01','A',3,{unit:'Gram'}),row('2026-11-01','A',4,{state:'SELANGOR'}),row('2026-11-01','B',5)];
  assert.equal(cmp(rows),null);
});
test('Top Movers eligibility needs at least three distinct matching markets',()=>{
  const rows=[];
  for(const market of ['A','B','C']){
    rows.push(row('2026-11-02',market,9));
    rows.push(row('2026-11-01',market,6));
  }
  const strong=cmp(rows);
  assert.equal(strong.markets,3);
  assert.equal(strong.eligible,true);
  assert.equal(strong.percent,50);
  assert.equal(cmp(rows.filter(r=>r.lokasi!=='C')).eligible,false);
});
test('archive manifest distinguishes known missing files and legitimate non-reporting dates',async()=>{
  let requests=0;
  const loader=new ArchiveLoader({
    fetcher:async()=>{requests++;return {status:404,ok:false};},
    parseCSV:()=>[],
    baseUrl:'https://example.test/data/daily/',
    availableDates:['2026-11-02']
  });
  await loader.fetchDate('2026-11-01');
  assert.equal(requests,0);
  assert.ok(loader.absent.has('2026-11-01'));
  await assert.rejects(loader.fetchDate('2026-11-02'),/Expected FAMA CSV missing/);
  assert.equal(requests,3);
});
test('stock-style market history control and 17 original export fields remain in dashboard',()=>{
  assert.match(html,/id="trend-mode"/);
  assert.match(html,/id="trend-market"/);
  assert.match(html,/id="export-raw"/);
  assert.match(html,/const COLUMNS=\['priceid','tarikh_harga','systemdate'/);
  assert.match(html,/marketAverage\(rows\)/);
});
