import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHeatmap,treemapLayout,heatmapColor} from '../site/v3.1/heatmap.mjs';
import {readFileSync} from 'node:fs';

function quote(name,{level='Borong',state='',category='Sayur-Sayuran',markets=6,
  previous=10,current=11,eligible=true,period=7}={}){
  const previousDate=period===1?'2026-11-20':period===7?'2026-11-14':'2026-10-22';
  const raw=(current-previous)/previous*100;
  return {
    product_key:name+'||F.A.Q||Kilogram',varieti:name,gred:'F.A.Q',unit:'Kilogram',
    kategori:category,state,level,date:'2026-11-21',price:current,markets,
    changes:{[period]:{
      eligible,percent:Math.abs(raw)<0.05?0:raw,rawPercent:raw,
      previous,current,rmDifference:current-previous,
      markets,currentMarkets:markets+2,previousMarkets:markets+2,
      currentCoverage:markets/(markets+2),previousCoverage:markets/(markets+2),
      previousDate,currentDate:'2026-11-21',days:period,actualDays:period
    }}
  };
}

test('heatmap uses only real, matched-market eligible data in the requested level and state',()=>{
  const all=[
    quote('TIMUN',{markets:12}),
    quote('CILI',{markets:6,previous:12,current:9}),
    quote('PISANG',{category:'Buah-Buahan',markets:5}),
    quote('EXCLUDED',{eligible:false}),
    quote('LOCAL',{state:'PERAK'}),
    quote('FARM',{level:'Ladang'})
  ];
  const result=prepareHeatmap(all,{period:7,level:'Borong',state:''});
  assert.equal(result.total,4);
  assert.equal(result.shown,3);
  assert.equal(result.excluded,1);
  assert.equal(result.groups.length,2);
  assert.equal(result.groups[0].weight,18);
  assert.deepEqual(result.tiles.map(x=>x.name),['TIMUN','CILI','PISANG']);
  assert.equal(result.tiles[0].weight,12);
  assert.equal(result.tiles[0].currentMean,11);
  assert.equal(result.tiles[0].evidence.currentDate,'2026-11-21');
  assert.equal(result.tiles[1].percent,-25);
  assert.equal(prepareHeatmap(all,{level:'Ladang',state:'',period:7}).shown,1);
  assert.equal(prepareHeatmap(all,{state:'PERAK',period:7}).shown,1);
  assert.equal(prepareHeatmap(all,{state:'',period:1}).shown,0);
});
test('heatmap preserves source date, magnitude and grade; never invents invalid price comparisons',()=>{
  const malformed=quote('BAD');
  malformed.changes[7].currentCoverage=.1;
  const out=prepareHeatmap([quote('REAL'),malformed,quote('BIG',{current:18})],{state:''});
  assert.equal(out.shown,2);
  assert.equal(out.excluded,1);
  const real=out.tiles.find(tile=>tile.name==='REAL');
  const big=out.tiles.find(tile=>tile.name==='BIG');
  assert.equal(real.previousDate,'2026-11-14');
  assert.equal(real.actualDays,7);
  assert.equal(real.grade,'F.A.Q');
  assert.equal(big.percent,80);
  assert.equal(prepareHeatmap([quote('REAL')],{period:12}).shown,0);
});
test('16-state overview distinguishes actual observations from non-comparable changes and empty locations',()=>{
  const rows=[
    quote('TIMUN',{state:'SARAWAK',markets:6}),
    quote('CILI',{state:'PERAK',markets:2}),
    quote('TOMATO',{state:'SELANGOR',markets:5,eligible:false})
  ];
  const out=prepareHeatmap(rows,{state:'__ALL_STATES__',level:'Borong',period:7});
  assert.equal(out.groups.length,16);
  assert.equal(out.shown,3);
  assert.equal(out.coverage,3);
  assert.equal(out.comparable,1);
  assert.equal(out.excluded,2);
  assert.deepEqual(out.groups.map(g=>g.name).slice(0,2),['JOHOR','KEDAH']);
  const swk=out.groups.find(g=>g.name==='SARAWAK');
  const perak=out.groups.find(g=>g.name==='PERAK');
  const melaka=out.groups.find(g=>g.name==='MELAKA');
  assert.equal(swk.items[0].percent,10);
  assert.equal(perak.items[0].percent,null);
  assert.equal(perak.items[0].price,11);
  assert.equal(melaka.observed,0);
  assert.equal(melaka.items.length,0);
});
test('state-specific mode does not hide actual FAMA prices when percent cannot be verified',()=>{
  const rows=[quote('CILI',{state:'PERAK',eligible:false})];
  const result=prepareHeatmap(rows,{state:'PERAK',period:7});
  assert.equal(result.shown,1);
  assert.equal(result.comparable,0);
  assert.equal(result.tiles[0].price,11);
  assert.equal(result.tiles[0].percent,null);
});

test('treemap tiles cover a box proportionally without overlap or negative coordinates',()=>{
  for(const [width,height] of [[1200,570],[350,730],[90,90]]){
    const items=[{weight:20},{weight:12},{weight:6},{weight:3},{weight:1}];
    const layout=treemapLayout(items,width,height);
    assert.equal(layout.length,5);
    const sum=layout.reduce((total,r)=>total+r.w*r.h,0);
    assert.ok(Math.abs(sum-width*height)<.001);
    for(const [index,a] of layout.entries()){
      assert.ok(a.x>=-1e-8&&a.y>=-1e-8&&a.w>=0&&a.h>=0);
      assert.ok(a.x+a.w<=width+.001&&a.y+a.h<=height+.001);
      for(const b of layout.slice(index+1)){
        const overlap=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*
          Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
        assert.ok(overlap<.01,'treemap rectangles must not overlap');
      }
    }
  }
  assert.deepEqual(treemapLayout([],200,200),[]);
});
test('color semantics: positive green, negative red, near-zero neutral',()=>{
  assert.match(heatmapColor(10),/hsl\(153 /);
  assert.match(heatmapColor(-10),/hsl\(355 /);
  assert.equal(heatmapColor(0),'#3b4b4c');
  assert.equal(heatmapColor(NaN),'#3b4b4c');
});
test('overview includes real heatmap controls after quick prices, with separate page state',()=>{
  const html=readFileSync(new URL('../site/v3.1/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../site/v3.1/app.mjs',import.meta.url),'utf8');
  const css=readFileSync(new URL('../site/v3.1/heatmap.css',import.meta.url),'utf8');
  for(const id of ['market-heatmap-canvas','market-heatmap-level','market-heatmap-state',
    'market-heatmap-period','market-heatmap-date','market-heatmap-play','market-heatmap-summary'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.ok(html.indexOf('id="quick-prices"')<html.indexOf('class="market-heatmap-panel"'));
  assert.ok(html.indexOf('class="market-heatmap-panel"')<html.indexOf('data-screen="prices"'));
  assert.match(html,/heatmap\.css\?rev=/);
  assert.match(app,/marketHeatmap\.refresh\(overview,meta\)/);
  assert.match(app,/marketHeatmap\.bind\(\)/);
  const heatmap=readFileSync(new URL('../site/v3.1/heatmap.mjs',import.meta.url),'utf8');
  assert.match(heatmap,/showComparison\(tile\.evidence\)/);
  assert.match(css,/\.market-hm-canvas/);
  for(const id of ['market-heatmap-prev','market-heatmap-next','market-heatmap-latest',
    'market-heatmap-speed','market-heatmap-date-count','market-heatmap-ticks'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/历史行情回放/);
  assert.match(html,/只播放有真实档案的日期/);
  assert.match(heatmap,/dateTicks\.innerHTML=/);
  assert.match(heatmap,/previousButton\.addEventListener\('click'/);
  assert.match(heatmap,/nextButton\.addEventListener\('click'/);
  assert.match(heatmap,/latestButton\.addEventListener\('click'/);
  assert.match(heatmap,/speedSelector\.addEventListener\('change'/);
  assert.match(html,/value="__ALL_STATES__" selected/);
  assert.match(heatmap,/MALAYSIA_STATES/);
  assert.match(heatmap,/market-hm-no-data/);
  assert.match(css,/\.market-hm-canvas\.all-states/);
  assert.match(css,/\.market-hm-replay-main/);
  assert.match(css,/@media\(max-width:550px\)/);
});
