import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productHistoryRecords,productHistoryCSV} from '../site/v3.1/product-history.mjs';

const index=JSON.parse(readFileSync(new URL('../site/data/v3/history-index.json',import.meta.url),'utf8'));
const ayam=index.products.find(p=>p.varieti==='AYAM PROSES STANDARD');
const history=JSON.parse(readFileSync(new URL('../site/data/v3/'+ayam.path,import.meta.url),'utf8'));

test('full state archive does not drop old observations and never substitutes other states',()=>{
  const raw=history.observations.filter(p=>p.state==='PERAK');
  const full=productHistoryRecords(history,{state:'PERAK'});
  assert.equal(full.length,raw.filter(p=>Number.isFinite(p.price)&&p.markets>0).length);
  assert.ok(full.length>100,'all levels and every actual archived date, not a 30/90-day preview');
  assert.ok(full.every(p=>p.state==='PERAK'));
  assert.ok(full.every(p=>p.date<=history.observations.at(-1).date));
  assert.deepEqual([...full].map(p=>p.date),[...full].map(p=>p.date).sort().reverse());
  assert.deepEqual(new Set(full.map(p=>p.level)),new Set(['Ladang','Borong','Runcit']));
});

test('filtered Borong archive contains every date from the true FAMA history JSON',()=>{
  const borong=productHistoryRecords(history,{state:'PERAK',level:'Borong'});
  const reference=history.observations.filter(p=>p.state==='PERAK'&&p.level==='Borong'&&p.markets>0);
  assert.equal(borong.length,reference.length);
  assert.ok(borong.length>30);
  assert.deepEqual(new Set(borong.map(p=>p.date)),new Set(reference.map(p=>p.date)));
  assert.equal(borong[0].price,reference.at(-1).price);
  assert.equal(productHistoryRecords(history,{state:'PERAK',level:'Invalid'}).length,0);
  assert.equal(productHistoryRecords(history,{state:'W.P. LABUAN',level:'Borong'}).length,
    history.observations.filter(p=>p.state==='W.P. LABUAN'&&p.level==='Borong'&&p.markets>0).length);
});

test('history CSV preserves full dates, real average prices, market counts and source units',()=>{
  const selected=productHistoryRecords(history,{state:'PERAK',level:'Borong'});
  const csv=productHistoryCSV(history,selected);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv.trim().split('\r\n').length,selected.length+1);
  assert.ok(csv.includes('"PERAK"'));
  assert.ok(csv.includes('"Kilogram"'));
  assert.ok(csv.includes('"AYAM PROSES STANDARD"'));
  for(const row of selected.slice(0,5)){
    assert.ok(csv.includes('"'+row.date+'"'));
    assert.ok(csv.includes('"'+row.price.toFixed(4)+'"'));
  }
  const injected={...history,varieti:'=HYPERLINK("x")'};
  assert.ok(productHistoryCSV(injected,selected).includes("'=HYPERLINK"));
});

test('single state Heatmap tile routes to its own history rather than the strict change dialog',()=>{
  const heatmap=readFileSync(new URL('../site/v3.1/heatmap.mjs',import.meta.url),'utf8');
  const app=readFileSync(new URL('../site/v3.1/app.mjs',import.meta.url),'utf8');
  const html=readFileSync(new URL('../site/v3.1/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../site/v3.1/product-history.css',import.meta.url),'utf8');
  assert.match(heatmap,/showPreview\(tile,snapshot\)/);
  assert.match(heatmap,/showProductHistory\(tile\.key,tile\.region,tile\.level,snapshot\.survey_date,snapshot\)/);
  assert.match(app,/function openHeatmapProductHistory\(key,state,level,date,snapshot\)/);
  assert.match(app,/openProductDetail\(key,\{state,level,fullHistory:true,snapshot\}\)/);
  assert.match(app,/productHistoryRecords\(history,\{state,level,endDate:detailSnapshot\(\)\.survey_date\}\)/);
  assert.match(app,/loadDaily\(date\)/);
  assert.match(app,/productAreaRows\(rows,\{productKey:key,state,excludedPriceIds:excluded\}\)/);
  assert.match(app,/renderProductHistorical\(\)/);
  assert.match(app,/selectedWindow==='all'/);
  assert.match(app,/detail\.snapshot=snapshot\|\|store\.overview/);
  assert.match(app,/date=detailSnapshot\(\)\.survey_date/);
  assert.match(app,/end=detailSnapshot\(\)\.survey_date/);
  assert.match(app,/async function showHeatmapPreview\(tile,snapshot\)/);
  assert.match(html,/id="market-heatmap-preview"/);
  assert.match(html,/<option value="all">全部已归档日期<\/option>/);
  assert.match(html,/完整历史价格记录/);
  assert.match(html,/product-history\.css\?rev=/);
  for(const id of ['product-history-body','product-history-level','product-history-more',
    'product-history-export','product-history-market-panel','product-history-market-body',
    'product-history-market-close']){
    assert.ok(html.includes('id="'+id+'"'));
  }
  assert.match(css,/\.product-history-panel/);
});
