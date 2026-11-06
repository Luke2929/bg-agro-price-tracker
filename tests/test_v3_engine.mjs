import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ageDays,mytDate,rankMovers,filterQuotes,historySeries,parseCSV,
  summarizeRows,FAMA_COLUMNS,productIdentity,canonicalDailyRows,productAreaRows,
  localLevelPrices,productScopePrices,productAreaOptions} from '../site/v3.1/engine.mjs';
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

function marketRow(id,{date='2026-11-06',level='Borong',state='PERAK',district='KINTA',
  location='PASAR IPOH',sublevel='20',grade='A',unit='Kilogram',price='4'}={}){
  return {priceid:id,tarikh_harga:date,negeri:state,daerah:district,lokasi:location,
    sublevel,varieti:'BAYAM',gred:grade,unit,peringkat:level,harga:price};
}

test('V3.1 product details preserve exact Python variety/grade/unit identity',()=>{
  assert.equal(productIdentity(marketRow('1')),'BAYAM||A||Kilogram');
  assert.equal(productIdentity(marketRow('2',{grade:'B'})),'BAYAM||B||Kilogram');
  assert.equal(productIdentity(marketRow('3',{unit:'Biji'})),'BAYAM||A||Biji');
  assert.equal(productAreaRows([marketRow('1'),marketRow('2',{grade:'B'}),
    marketRow('3',{unit:'Biji'})],{productKey:'BAYAM||A||Kilogram'}).length,1);
});

test('V3.1 canonical raw records exclude old revisions and latest duplicate priceids',()=>{
  const rows=[marketRow('7',{price:'5'}),marketRow('7',{grade:'B',price:'8'}),
    marketRow('8',{price:''}),marketRow('9',{price:'11'}),marketRow('10',{price:'6'})];
  assert.equal(canonicalDailyRows(rows).length,4);
  assert.deepEqual(productAreaRows(rows,{productKey:'BAYAM||A||Kilogram',
    excludedPriceIds:['9']}).map(r=>r.priceid),['8','10']);
  assert.equal(localLevelPrices(productAreaRows(rows,{productKey:'BAYAM||A||Kilogram',
    excludedPriceIds:['9']})).find(x=>x.level==='Borong').price,6);
});

test('V3.1 local market mean votes once per market and keeps all three levels separate',()=>{
  const rows=[marketRow('1',{price:'2'}),marketRow('2',{price:'4'}),
    marketRow('3',{location:'PASAR KAMPAR',price:'12'}),
    marketRow('4',{level:'Ladang',price:'1'}),
    marketRow('5',{level:'Runcit',price:''})];
  const prices=localLevelPrices(rows);
  assert.equal(prices[0].price,1);
  assert.equal(prices[1].price,7.5); // (mean 3 from market A + 12 from B) / 2
  assert.equal(prices[1].markets,2);
  assert.equal(prices[1].observations,3);
  assert.equal(prices[2].price,null); // Blank is not RM0
});

test('V3.1 Negeri to Daerah to Lokasi filters exact product and exact locality',()=>{
  const rows=[marketRow('1'),marketRow('2',{district:'BATANG PADANG',location:'TAPAH'}),
    marketRow('3',{state:'SELANGOR',district:'PETALING',location:'PUCHONG'}),
    marketRow('4',{district:'KINTA',location:'PASAR IPOH',grade:'B'})];
  const options=productAreaOptions(rows,{productKey:'BAYAM||A||Kilogram',state:'PERAK'});
  assert.deepEqual(options.districts,['BATANG PADANG','KINTA']);
  assert.deepEqual(productAreaOptions(rows,{productKey:'BAYAM||A||Kilogram',
    state:'PERAK',district:'KINTA'}).locations,['PASAR IPOH']);
  assert.equal(productAreaRows(rows,{productKey:'BAYAM||A||Kilogram',state:'PERAK',
    district:'KINTA',location:'PASAR IPOH'}).length,1);
});

test('V3.1 state snapshot remains authoritative until locality is selected',()=>{
  const key='BAYAM||A||Kilogram';
  const overview=[{product_key:key,state:'',level:'Borong',price:5,markets:10,observations:20},
    {product_key:key,state:'PERAK',level:'Borong',price:4,markets:3,observations:5}];
  const rows=[marketRow('1',{price:'6'}),marketRow('2',{location:'PASAR KAMPAR',price:'10'})];
  assert.equal(productScopePrices(overview,rows,{productKey:key}).find(x=>x.level==='Borong').price,5);
  assert.equal(productScopePrices(overview,rows,{productKey:key,state:'PERAK'}).find(x=>x.level==='Borong').price,4);
  assert.equal(productScopePrices(overview,null,{productKey:key,state:'PERAK',district:'KINTA'}),null);
  assert.equal(productScopePrices(overview,rows,{productKey:key,state:'PERAK',district:'KINTA'})
    .find(x=>x.level==='Borong').price,8);
  assert.equal(productScopePrices(overview,rows,{productKey:key,state:'PERAK',district:'KINTA',
    location:'PASAR IPOH'}).find(x=>x.level==='Borong').price,6);
});

test('V3.1 district engine reconciles against every real latest V3 product price',()=>{
  const overview=JSON.parse(readFileSync(new URL('../site/data/v3/overview.json',import.meta.url),'utf8'));
  const meta=JSON.parse(readFileSync(new URL('../site/data/meta.json',import.meta.url),'utf8'));
  const raw=parseCSV(readFileSync(new URL(`../data/daily/${overview.survey_date}.csv`,import.meta.url),'utf8'));
  const excluded=meta.superseded_priceids?.[overview.survey_date]||[];
  for(const quote of overview.prices){
    const area=productAreaRows(raw,{productKey:quote.product_key,state:quote.state,
      excludedPriceIds:excluded});
    const actual=localLevelPrices(area).find(q=>q.level===quote.level);
    assert.ok(actual&&Math.abs(actual.price-quote.price)<1e-9,
      `Mismatch for ${quote.product_key} / ${quote.level} / ${quote.state}`);
    assert.equal(actual.markets,quote.markets);
    assert.equal(actual.observations,quote.observations);
  }
});
