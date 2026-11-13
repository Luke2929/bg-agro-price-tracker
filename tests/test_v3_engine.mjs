import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ageDays,mytDate,rankMovers,dailyStorySignals,buildMarketPostIdea,filterQuotes,quoteChange,historySeries,parseCSV,
  summarizeRows,FAMA_COLUMNS,sortQuotesByChange,groupQuotesByProduct,archiveComparisonDates,
  buildPriceDateSnapshot,shiftSurveyDate,productIdentity,canonicalDailyRows,productAreaRows,
  localLevelPrices,productScopePrices,productAreaOptions} from '../site/v3.1/engine.mjs';
import {buildXlsx} from '../site/v3.1/excel.mjs';

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

test('price-change ranking covers 1/7/30 days, both directions and biggest swings without changing source rows',()=>{
  const make=(name,p1,p7,p30,eligible=true)=>({
    varieti:name,level:'Borong',state:'',gred:'A',unit:'Kilogram',kategori:'Vegetables',
    changes:{
      1:{percent:p1,eligible},7:{percent:p7,eligible},30:{percent:p30,eligible}
    }
  });
  const prices=[
    make('ABC',3,-4,6),make('DEF',19,10,-15),make('GHI',-28,-13,4),
    make('JKL',5,0,50),make('MNO',null,0,0),make('ZZZ',100,100,100,false)
  ];
  const filtered=filterQuotes(prices,{state:''});
  assert.deepEqual(sortQuotesByChange(filtered,{period:1,order:'rise'}).map(x=>x.varieti),['DEF','JKL','ABC']);
  assert.deepEqual(sortQuotesByChange(filtered,{period:7,order:'fall'}).map(x=>x.varieti),['GHI','ABC']);
  assert.deepEqual(sortQuotesByChange(filtered,{period:30,order:'swing'}).map(x=>x.varieti),['JKL','DEF','ABC','GHI','MNO']);
  assert.deepEqual(sortQuotesByChange(filtered,{period:7,order:'name'}).map(x=>x.varieti),filtered.map(x=>x.varieti));
  assert.equal(filtered.length,prices.length,'sorting does not remove source quotations');
  assert.equal(sortQuotesByChange(filtered,{period:7,order:'rise'}).some(x=>x.varieti==='ZZZ'),false);
});

test('price change filters apply within existing geographic and level filters without cross-state mixing',()=>{
  const make=(state,level,pct)=>({
    varieti:'CILI',state,level,gred:'A',unit:'Kilogram',kategori:'Vegetables',
    changes:{7:{percent:pct,eligible:true}}
  });
  const prices=[make('', 'Borong',8),make('PERAK','Borong',22),make('PERAK','Runcit',-11)];
  assert.deepEqual(sortQuotesByChange(filterQuotes(prices,{state:'PERAK',level:'Borong'}),{period:7,order:'rise'}).map(x=>x.state),['PERAK']);
  assert.equal(sortQuotesByChange(filterQuotes(prices,{state:'PERAK',level:'Borong'}),{period:7,order:'fall'}).length,0);
  assert.equal(sortQuotesByChange(filterQuotes(prices,{state:'PERAK',level:'Runcit'}),{period:7,order:'fall'}).length,1);
});

test('grouped price view shows product identity once, keeps all L/B/R levels and independent prices',()=>{
  const create=(varieti,level,percent,grade='F.A.Q',unit='Kilogram',state='PERAK')=>({
    product_key:[varieti,grade,unit].join('||'),varieti,gred:grade,unit,state,level,
    price:level==='Ladang'?2:level==='Borong'?4:6,
    changes:{30:{eligible:percent!==null,percent}}
  });
  const rows=[
    create('SAWI HIJAU','Runcit',-12),create('CILI','Borong',-5),
    create('SAWI HIJAU','Borong',-8.9),create('SAWI HIJAU','Ladang',+4),
    create('CILI','Runcit',-10),create('SAWI HIJAU','Runcit',-20,'A'),
    create('SAWI HIJAU','Borong',-17,'F.A.Q','Biji'),
    create('SAWI HIJAU','Runcit',-25,'F.A.Q','Kilogram','JOHOR'),
  ];
  const perak=rows.filter(p=>p.state==='PERAK');
  const grouped=groupQuotesByProduct(perak,{period:30,order:'fall'});
  assert.equal(grouped.length,4,'product grade/unit/state identities must remain separate');
  const sawi=grouped.find(g=>g.quotes[0].varieti==='SAWI HIJAU'&&g.quotes[0].gred==='F.A.Q'&&g.quotes[0].unit==='Kilogram');
  assert.ok(sawi);
  assert.equal(sawi.leader.level,'Runcit','the most negative eligible level ranks this product');
  assert.deepEqual(sawi.quotes.map(p=>p.level),['Ladang','Borong','Runcit']);
  assert.deepEqual(sawi.quotes.map(p=>p.price),[2,4,6]);
  assert.equal(sawi.quotes[0].changes[30].percent,4,'other direction stays visible for context');
  assert.equal(grouped[0].quotes[0].gred,'A','the strongest decline across distinct grades ranks first');
  assert.equal(grouped[0].leader.changes[30].percent,-20);
  assert.equal(grouped[1].quotes[0].unit,'Biji','distinct units remain separate products');
  assert.equal(grouped[1].leader.changes[30].percent,-17);
  assert.equal(rows.length,8,'source quotations remain untouched');
  assert.equal(rows[0].level,'Runcit','source order is not mutated');
  const names=groupQuotesByProduct(perak,{period:30,order:'name'});
  assert.equal(names.length,4);
  assert.ok(names.every(g=>g.leader===null),'default order has no nominated leader');
});

test('group sorting uses only eligible matched markets and preserves nonqualifying level context',()=>{
  const q=(varieti,level,pct,eligible=true)=>({
    product_key:varieti+'||A||Kilogram',varieti,gred:'A',unit:'Kilogram',
    level,state:'',changes:{7:{percent:pct,eligible}}
  });
  const rows=[
    q('TOMATO','Runcit',-9),q('TOMATO','Borong',7),
    q('SAWI','Runcit',-12),q('SAWI','Borong',-8.9),
    q('BAYAM','Runcit',-25,false),q('BAYAM','Ladang',1),
    q('EMPTY','Borong',null,false)
  ];
  const falls=groupQuotesByProduct(rows,{period:7,order:'fall'});
  assert.deepEqual(falls.map(x=>x.quotes[0].varieti),['SAWI','TOMATO']);
  assert.deepEqual(falls.map(x=>x.quotes.length),[2,2]);
  assert.equal(falls[1].leader.level,'Runcit');
  assert.equal(falls[1].quotes.find(q=>q.level==='Borong').changes[7].percent,7);
  const rises=groupQuotesByProduct(rows,{period:7,order:'rise'});
  assert.deepEqual(rises.map(x=>x.quotes[0].varieti),['TOMATO','BAYAM']);
  assert.equal(rises[1].leader.level,'Ladang');
});

test('archive comparison windows are anchored to the selected date and only contain real CSV dates',()=>{
  const all=['2026-09-30','2026-10-12','2026-10-13','2026-10-18','2026-10-19','2026-10-20','2026-10-21'];
  assert.deepEqual(archiveComparisonDates(all,'2026-10-20'),[
    '2026-10-20','2026-10-19','2026-10-18','2026-10-13','2026-10-12'
  ]);
  assert.deepEqual(archiveComparisonDates(all,'2026-08-08'),[]);
  assert.equal(shiftSurveyDate('2026-10-20',-30),'2026-09-20');
  assert.equal(shiftSurveyDate('2026-03-01',-1),'2026-02-28');
  assert.equal(shiftSurveyDate('2026-03-01',-30),'2026-01-30');
});

test('selected historical date recomputes independent matched 1/7/30-day comparisons, not latest nationwide price',()=>{
  const row=(date,id,place,price,product='BAYAM',level='Borong')=>({
    tarikh_harga:date,priceid:id,negeri:'PERAK',daerah:'KINTA',lokasi:place,
    sublevel:'20',peringkat:level,varieti:product,gred:'F.A.Q',
    unit:'Kilogram',kategori:'Sayur-Sayuran',harga:String(price)
  });
  const makeDay=(date,prices)=>prices.map((price,i)=>row(date,date+'-'+i,['A','B','C'][i],price));
  const current='2026-11-13',previous='2026-11-12',week='2026-11-06',month='2026-10-14';
  const csv=new Map([
    [current,[...makeDay(current,[12,14,16]),row(current,'tomato','A',10,'TOMATO','Runcit')]],
    [previous,[...makeDay(previous,[10,12,14]),row(previous,'tomato-old','A',5,'TOMATO','Runcit')]],
    [week,makeDay(week,[8,10,12])],
    [month,makeDay(month,[4,6,8])],
  ]);
  const dates=[month,week,previous,current];
  assert.deepEqual(archiveComparisonDates(dates,current),[current,previous,week,month]);
  const snapshot=buildPriceDateSnapshot(csv,{surveyDate:current,archiveDates:dates});
  assert.equal(snapshot.survey_date,current);
  const bayam=snapshot.prices.find(p=>p.varieti==='BAYAM'&&p.level==='Borong'&&p.state==='');
  assert.ok(bayam);
  assert.equal(bayam.price,14);
  assert.equal(bayam.markets,3);
  assert.equal(bayam.observations,3);
  assert.equal(bayam.changes['1'].previousDate,previous);
  assert.equal(bayam.changes['7'].previousDate,week);
  assert.equal(bayam.changes['30'].previousDate,month);
  assert.equal(bayam.changes['1'].percent,(14-12)/12*100);
  assert.equal(bayam.changes['7'].percent,40);
  assert.ok(Math.abs(bayam.changes['30'].percent-133.33333333333334)<0.001);
  assert.equal(bayam.changes['7'].markets,3);
  assert.equal(bayam.changes['7'].currentCoverage,1);
  assert.equal(bayam.changes['7'].previousCoverage,1);
  assert.equal(bayam.changes['7'].eligible,true);
  const state=snapshot.prices.find(p=>p.varieti==='BAYAM'&&p.state==='PERAK');
  assert.equal(state.changes['7'].percent,40);
  const tomato=snapshot.prices.find(p=>p.varieti==='TOMATO'&&p.state==='');
  assert.equal(tomato.changes['1'].percent,100);
  assert.equal(tomato.changes['1'].eligible,false,'one shared market is not sufficient');
  assert.equal(quoteChange(tomato,1),null);
  assert.deepEqual(sortQuotesByChange(filterQuotes(snapshot.prices,{state:'',level:'Borong'}),{period:7,order:'rise'}).map(x=>x.varieti),['BAYAM']);
  assert.equal(snapshot.states[0],'PERAK');
});

test('selected date honors older baseline fallback and rejects incomplete or revised archive days',()=>{
  const r=(date,id,market,price,level='Borong')=>({
    priceid:id,tarikh_harga:date,negeri:'PERAK',daerah:'KINTA',lokasi:market,
    sublevel:'10',peringkat:level,varieti:'CILI',gred:'F.A.Q',unit:'Kilogram',
    kategori:'Sayur-Sayuran',harga:String(price)
  });
  const date='2026-10-20',older='2026-10-12';
  const dates=[older,date];
  const rows=new Map([
    [date,[r(date,'latest','A',20),r(date,'old-revision','B',200),r(date,'new-revision','B',22),r(date,'third','C',24)]],
    [older,[r(older,'first','A',10),r(older,'second','B',12),r(older,'third','C',14)]],
  ]);
  const snapshot=buildPriceDateSnapshot(rows,{
    surveyDate:date,archiveDates:dates,supersededByDate:{[date]:['old-revision']}
  });
  const item=snapshot.prices.find(p=>!p.state);
  assert.equal(item.price,22);
  assert.equal(item.observations,3);
  assert.equal(item.changes['7'].previousDate,older);
  assert.equal(item.changes['7'].actualDays,8);
  assert.equal(item.changes['7'].percent,(22-12)/12*100);
  assert.equal(item.changes['1'],null);
  assert.equal(item.changes['30'],null);
  assert.equal(quoteChange(item,1),null);
  assert.throws(()=>buildPriceDateSnapshot(new Map([[date,rows.get(date)]]),{
    surveyDate:date,archiveDates:dates
  }),/缺少历史原始 CSV/);
  const bad=new Map(rows);
  bad.set(older,[r('2026-10-11','wrong','A',15)]);
  assert.throws(()=>buildPriceDateSnapshot(bad,{surveyDate:date,archiveDates:dates}),
    /日期不匹配/);
});

test('matched date lookup never substitutes an invalid candidate with older one',()=>{
  const day='2026-11-13',first='2026-11-06',earlier='2026-11-05';
  const item=(date,n,place,price)=>({
    priceid:date+'-'+n,tarikh_harga:date,negeri:'PERAK',
    daerah:'KINTA',lokasi:place,sublevel:'20',peringkat:'Runcit',
    varieti:'TOMATO',gred:'F.A.Q',unit:'Kilogram',kategori:'Sayur-Sayuran',harga:String(price)
  });
  const rows=new Map([
    [day,[item(day,1,'A',10),item(day,2,'B',10),item(day,3,'C',10)]],
    [first,[item(first,1,'A',5)]], // candidate has one common market, so ineligible
    [earlier,[item(earlier,1,'A',5),item(earlier,2,'B',5),item(earlier,3,'C',5)]],
  ]);
  const snapshot=buildPriceDateSnapshot(rows,{surveyDate:day,archiveDates:[earlier,first,day]});
  const change=snapshot.prices.find(p=>!p.state).changes['7'];
  assert.equal(change.previousDate,first);
  assert.equal(change.markets,1);
  assert.equal(change.eligible,false);
  assert.equal(quoteChange(snapshot.prices.find(p=>!p.state),7),null);
});


test('daily content board selects actual eligible nationwide rises and falls, without state or low-market duplicates',()=>{
  const make=(name,level,pct,{eligible=true,state='',markets=16,prev='2026-11-06'}={})=>({
    varieti:name,product_key:name+'||F.A.Q||Kilogram',gred:'F.A.Q',unit:'Kilogram',
    level,state,changes:{7:{percent:pct,eligible,markets,previousDate:prev,
      currentCoverage:1,previousCoverage:1}}
  });
  const quotes=[
    make('TOMATO','Runcit',11.44),
    make('BAYAM','Borong',9.78),
    make('KACANG PANJANG','Runcit',-6.68),
    make('KACANG PANJANG','Borong',-6.12),
    make('TELUR AYAM','Ladang',-90.94),
    make('TEST IMPOSSIBLE','Runcit',99,{eligible:false,markets:1}),
    make('STATE ONLY','Runcit',-45,{state:'PERAK'})
  ];
  const analysis=dailyStorySignals(quotes,7);
  assert.equal(analysis.comparableCount,5);
  assert.equal(analysis.rise.varieti,'TOMATO');
  assert.equal(analysis.fall.varieti,'KACANG PANJANG');
  assert.equal(analysis.extreme.varieti,'TELUR AYAM');
  assert.equal(analysis.extremeCount,1);
  assert.equal(analysis.aligned,null);
  const post=buildMarketPostIdea(analysis.rise,7,'2026-11-13');
  assert.match(post,/TOMATO NAIK \+11\.4%/);
  assert.match(post,/2026-11-13 berbanding 2026-11-06/);
  assert.match(post,/16 lokasi pasaran yang sama/);
  assert.match(post,/bukan harga tetap atau bukti keuntungan petani/);
  assert.equal(buildMarketPostIdea(analysis.extreme,7,'2026-11-13'),'');
  assert.equal(buildMarketPostIdea(quotes[5],7,'2026-11-13'),'');
  assert.equal(buildMarketPostIdea(quotes[6],7,'2026-11-13'),'');
});

test('daily content board spots all three level aligned trends using same product grade and unit',()=>{
  const q=(name,level,pct,unit='Kilogram')=>({
    varieti:name,gred:'F.A.Q',unit,product_key:name+'||F.A.Q||'+unit,state:'',
    level,changes:{30:{eligible:true,percent:pct,markets:9,previousDate:'2026-10-14'}}
  });
  const rows=[
    q('TIMUN HIJAU','Ladang',41),q('TIMUN HIJAU','Borong',28),q('TIMUN HIJAU','Runcit',21),
    q('BAYAM','Ladang',3),q('BAYAM','Borong',11),q('BAYAM','Runcit',9),
    q('CILI','Ladang',-8),q('CILI','Borong',-7),q('CILI','Runcit',-9),
    q('CILI','Runcit',-48,'Biji')
  ];
  const result=dailyStorySignals(rows,30);
  assert.equal(result.aligned.varieti,'TIMUN HIJAU');
  assert.equal(result.aligned.direction,'up');
  assert.deepEqual(result.aligned.levels.map(x=>x.level),['Ladang','Borong','Runcit']);
  assert.equal(result.aligned.strength,21);
  assert.equal(result.extremeCount,0);
  assert.match(buildMarketPostIdea(result.fall,30,'2026-11-13'),/TURUN -48\.0%/);
  assert.equal(dailyStorySignals(rows,1).rise,null,'no fabricated baseline for absent period');
});

test('daily editorial guards an extreme increase, mismatched levels, and non-price-zero returns',()=>{
  const one=(pct,level='Runcit',name='SAYUR')=>({
    product_key:name+'||F.A.Q||Kilogram',varieti:name,gred:'F.A.Q',
    unit:'Kilogram',level,state:'',changes:{1:{percent:pct,eligible:true,markets:3,previousDate:'2026-11-12'}}
  });
  const analysis=dailyStorySignals([one(50),one(-2,'Borong'),one(0,'Ladang')],1);
  assert.equal(analysis.extremeCount,1);
  assert.equal(analysis.rise,null);
  assert.equal(analysis.fall.level,'Borong');
  assert.equal(analysis.aligned,null);
  assert.equal(buildMarketPostIdea(one(0),1,'2026-11-13'),'');
  assert.equal(buildMarketPostIdea(null,1,'2026-11-13'),'');
});
