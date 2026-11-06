import test from 'node:test';
import assert from 'node:assert/strict';
import {ageDays,mytDate,rankMovers,filterQuotes,historySeries,parseCSV,
  summarizeRows,FAMA_COLUMNS} from '../site/v3/engine.mjs';
import {buildXlsx} from '../site/v3/excel.mjs';

function quote({state='',pct=5,eligible=true,grade='A',level='Borong'}={}){
  return {product_key:'BAYAM||'+grade+'||Kilogram',varieti:'BAYAM',gred:grade,
    level,state,kategori:'Sayur-Sayuran',changes:{1:{percent:pct,eligible}}};
}

test('MYT date and survey freshness are based on Malaysia day, not server UTC',()=>{
  assert.equal(mytDate(new Date('2026-11-05T17:00:00Z')),'2026-11-06');
  assert.equal(ageDays('2026-11-04','2026-11-06'),2);
  assert.equal(ageDays('invalid','2026-11-06'),null);
});

test('movers exclude state duplicates, poor coverage and non-moving quotes',()=>{
  const prices=[quote({pct:20}),quote({state:'PERAK',pct:60}),
    quote({grade:'B',pct:40,eligible:false}),quote({grade:'C',pct:-7})];
  assert.deepEqual(rankMovers(prices,1,'up').map(p=>p.gred),['A']);
  assert.deepEqual(rankMovers(prices,1,'down').map(p=>p.gred),['C']);
});

test('price table returns one selected geography and respects grade/search',()=>{
  const prices=[quote(),quote({state:'PERAK'}),quote({grade:'B',level:'Runcit'})];
  assert.equal(filterQuotes(prices,{state:''}).length,2);
  assert.equal(filterQuotes(prices,{state:'PERAK'}).length,1);
  assert.equal(filterQuotes(prices,{search:'bayam',level:'Runcit'}).length,1);
});

test('historical window does not backfill missing observations',()=>{
  const history={observations:[
    {date:'2026-06-01',level:'Borong',state:'',price:3},
    {date:'2026-11-01',level:'Borong',state:'',price:4},
    {date:'2026-11-06',level:'Borong',state:'',price:5},
    {date:'2026-11-06',level:'Borong',state:'PERAK',price:7}]};
  assert.deepEqual(historySeries(history,{days:30,level:'Borong',state:'',endDate:'2026-11-06'}).map(p=>p.price),[4,5]);
  assert.equal(historySeries(history,{days:180,level:'Borong',state:'',endDate:'2026-11-06'}).length,3);
});

test('CSV parser retains 17 columns, escaped quotes, embedded newlines and missing value',()=>{
  const input=FAMA_COLUMNS.join(',')+'\r\n'+[
    '42','2026-11-06','','PERAK','KINTA','"Market ""A""\nBlock 2"','Borong',
    '20','Sayur-Sayuran','','','BAYAM','A','Kilogram','','',''
  ].join(',')+'\r\n';
  const rows=parseCSV(input);
  assert.equal(rows.length,1);
  assert.equal(Object.keys(rows[0]).length,17);
  assert.equal(rows[0].lokasi,'Market "A"\nBlock 2');
  assert.equal(rows[0].harga,'');
  assert.throws(()=>parseCSV('x,y\n1,2'),/缺少必需字段/);
});

function row(id,date,location,harga,grade='A'){
  return {priceid:id,tarikh_harga:date,negeri:'PERAK',daerah:'KINTA',lokasi:location,
    sublevel:'20',varieti:'BAYAM',gred:grade,unit:'Kilogram',peringkat:'Borong',
    kategori:'Sayur-Sayuran',harga};
}

test('summary Excel input uses matched grade, equal markets and revision manifest',()=>{
  const rows=[row('1','2026-11-06','A','4'),row('2','2026-11-06','A','6'),
    row('3','2026-11-06','B','10'),row('5','2026-11-05','A','999'),
    row('5','2026-11-06','A','11','B'),row('6','2026-11-06','A','')];
  const summary=summarizeRows(rows,{'2026-11-05':['5']});
  assert.equal(summary.length,2);
  const a=summary.find(s=>s.gred==='A');
  assert.equal(a.price,7.5);
  assert.equal(a.markets,2);
  assert.equal(a.observations,3);
  assert.equal(summary.find(s=>s.gred==='B').price,11);
});

test('generated Excel is a real zip workbook and escapes formula-like source text',async()=>{
  const blob=buildXlsx(['Product','Price'],[['=HYPERLINK("http://evil")',3.6]],{
    sheetName:'Full Raw Data',notes:[['Source','FAMA']]});
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const view=new DataView(bytes.buffer);
  assert.equal(view.getUint32(0,true),0x04034B50);
  assert.ok(bytes.length>1500);
  const text=new TextDecoder().decode(bytes);
  assert.match(text,/xl\/worksheets\/sheet1.xml/);
  assert.match(text,/t="inlineStr"/);
  assert.match(text,/=HYPERLINK\(&quot;http:\/\/evil&quot;\)/);
  assert.match(text,/<v>3.6<\/v>/);
  assert.throws(()=>buildXlsx(['X'],[[],[]]),/row length/);
});
