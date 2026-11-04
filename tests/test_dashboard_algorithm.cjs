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
test('freshness badge uses Malaysia local date and distinguishes survey age from archive refresh',()=>{
  const start=html.indexOf('  function dataFreshness(latest,now=new Date()){');
  const end=html.indexOf('  function displaySource(){',start);
  assert.ok(start>=0&&end>start);
  const check=vm.runInNewContext(html.slice(start,end)+'; dataFreshness',{Date,Intl});
  assert.equal(check('2026-11-04',new Date('2026-11-03T17:00:00Z')).kind,'current');
  assert.equal(check('2026-11-03',new Date('2026-11-04T01:00:00Z')).kind,'pending');
  assert.equal(check('2026-11-03',new Date('2026-11-04T08:00:00Z')).kind,'delayed');
  assert.equal(check('2026-11-02',new Date('2026-11-04T08:00:00Z')).kind,'older');
  assert.equal(check('—',new Date('2026-11-04T08:00:00Z')).kind,'unavailable');
  assert.match(html,/id="fresh-status"/);
  assert.match(html,/不会立即从 FAMA 抓取/);
  assert.doesNotMatch(html,/● LIVE FAMA DATA/);
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
  assert.equal(strong.currentCoverage,1);
  assert.equal(cmp(rows.filter(r=>r.lokasi!=='C')).eligible,false);
});
test('high percentage from sparse coverage is excluded, and near-zero moves show 0.0%',()=>{
  const current=['A','B','C','D','E','F','G','H','I','J'].map(k=>row('2026-11-02',k,10));
  const old=['A','B','C'].map(k=>row('2026-11-01',k,5));
  const low=cmp([...current,...old]);
  assert.equal(low.markets,3);
  assert.ok(low.currentCoverage<0.5);
  assert.equal(low.eligible,false);
  const tiny=cmp([row('2026-11-02','A',9.999),row('2026-11-01','A',10)]);
  assert.equal(tiny.percent,0);
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

test('historical graph uses zero-baseline grouped bars and leaves unreported days empty',()=>{
  const start=html.indexOf('  function chartSVG(points,activeStates,from,to){');
  const end=html.indexOf('  function renderMarketRows(){',start);
  assert.ok(start>=0&&end>start);
  const fake={};
  for(const key of ['trend-chart','chart-grid','chart-paths','chart-empty']){
    fake[key]={innerHTML:'',hidden:true,style:{},setAttribute(name,value){this[name]=value;}};
  }
  const renderer=vm.runInNewContext(html.slice(start,end)+'; chartSVG',{
    $:key=>fake[key],COLORS:['#ab6f39','#0a7555'],states:()=>['PERAK','SELANGOR'],
    escapeHtml:x=>String(x),fmt:x=>'RM '+x.toFixed(2)
  });
  renderer([
    {state:'PERAK',date:'2026-10-05',value:3.5},
    {state:'PERAK',date:'2026-10-07',value:2.25},
    {state:'SELANGOR',date:'2026-10-06',value:2.9}
  ],['PERAK','SELANGOR'],'2026-10-05','2026-10-07');
  const bars=fake['chart-paths'].innerHTML;
  assert.equal((bars.match(/<rect class="chart-bar"/g)||[]).length,3);
  assert.doesNotMatch(bars,/<path/); // No fabricated interpolation or connecting lines
  assert.equal((bars.match(/PERAK · 2026-10-06/g)||[]).length,0); // Missing survey not filled
  assert.ok(fake['chart-grid'].innerHTML.includes('>0.00</text>')); // Every bar begins at RM0
  assert.equal(fake['chart-empty'].hidden,true);
  renderer([{state:'PERAK',date:'2026-11-03',value:3}],['PERAK'],'2026-08-06','2026-11-03');
  assert.ok(parseFloat(fake['trend-chart'].style.width)>730); // Scrollable 90D history
});
