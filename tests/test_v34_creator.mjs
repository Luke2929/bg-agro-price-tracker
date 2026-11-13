import test from 'node:test';
import assert from 'node:assert/strict';
import {
 WORKSPACE_SCHEMA,emptyWorkspace,readWorkspace,saveRecord,contentMetrics,toCSV,
 isValidISODate,findContentSignals,scoreOpportunity,composeCreatorDraft,
 observedStreak,normalizeMetrics,validateCreatorDraft,FORMATS,statePriceSpreads,sourceReviewQuotes
} from '../site/v3.1/creator-core.mjs';

const row=(name,level,pct,opt={})=>{
 const markets=opt.markets??15,previous=opt.was??6,current=previous*(1+pct/100);
 const change=(days,previousDate)=>({
   eligible:opt.eligible!==false,percent:pct,markets,
   currentCoverage:markets/17,previousCoverage:markets/17,currentMarkets:17,previousMarkets:17,
   previousDate,currentDate:'2026-11-13',days,actualDays:days,
   current,previous,rmDifference:current-previous
 });
 return {
   product_key:name+'||F.A.Q||Kilogram',varieti:name,gred:'F.A.Q',
   unit:'Kilogram',level,state:opt.state||'',kategori:opt.kategori||'Sayur-Sayuran',
   date:'2026-11-13',changes:{7:change(7,'2026-11-06'),30:change(30,'2026-10-14')}
 };
};
test('v3.2 discovers source-eligible produce by product identity and geographic scope',()=>{
 const data=[
  row('BAYAM','Ladang',5.8),row('BAYAM','Borong',9.7),row('BAYAM','Runcit',5.0),
  row('TIMUN','Borong',-6.2),row('CILI','Ladang',-4),row('CILI','Runcit',3),
  row('OUTLIER','Runcit',-90),row('FAKE','Runcit',70,{eligible:false}),
  row('BAYAM','Borong',55,{state:'PERAK'})
 ];
 const all=findContentSignals(data,{period:7});
 assert.equal(all.some(s=>s.product==='FAKE'),false);
 const bayam=all.find(s=>s.product==='BAYAM');
 assert.equal(bayam.aligned,true);
 assert.equal(bayam.levels.length,3);
 assert.equal(bayam.level,'Borong');
 assert.equal(bayam.publishable,true);
 assert.ok(bayam.score<=100 && bayam.score>0);
 assert.equal(all.find(s=>s.product==='OUTLIER').publishable,false);
 const local=findContentSignals(data,{period:7,region:'PERAK'});
 assert.equal(local.length,1);
 assert.equal(local[0].flagged,true);
 const rising=findContentSignals(data,{period:7,type:'rise'});
 assert.equal(rising.every(s=>s.percent>0&&s.publishable),true);
 assert.equal(rising.some(s=>s.product==='OUTLIER'),false);
 const divergent=findContentSignals(data,{period:7,type:'divergent'});
 assert.equal(divergent[0].product,'CILI');
 assert.equal(divergent[0].divergent,true);
 const audits=findContentSignals(data,{period:7,type:'audit'});
 assert.equal(audits[0].product,'OUTLIER');
 assert.ok(scoreOpportunity(data[1],{period:7,region:'PERAK'}).total>
  scoreOpportunity(data[1],{period:7,region:''}).total);
});
test('V3.3 builds dated, editable Malay/Chinese/video template without fake profits or causes',()=>{
 const s=findContentSignals([row('BAYAM','Borong',9.7)],{period:7})[0];
 const bm=composeCreatorDraft(s,{language:'bm',format:'discussion',channel:'facebook'});
 assert.match(bm.body,/BAYAM/);
 assert.match(bm.body,/\+9\.7%/);
 assert.match(bm.body,/2026-11-13 berbanding 2026-11-06/);
 assert.match(bm.body,/15 pasaran yang sama/);
 assert.match(bm.body,/FAMA AMI/);
 assert.match(bm.body,/Untung bergantung juga pada kos dan hasil jualan/);
 const mixed=composeCreatorDraft(s,{language:'both',format:'story',channel:'whatsapp'});
 assert.match(mixed.body,/—— 中文 ——/);
 assert.match(mixed.body,/共同调查市场/);
 const clip=composeCreatorDraft(s,{language:'bm',format:'video',channel:'tiktok'});
 assert.match(clip.body,/HOOK \(0–3s\)/);
 assert.match(clip.body,/#HargaPertanian/);
 const bad=findContentSignals([row('EGG','Ladang',-91)],{period:7})[0];
 assert.throws(()=>composeCreatorDraft(bad),/缺少可发布/);
});
test('V3.2 history streak describes observed means, not cross-date same-market proof',()=>{
 const history={observations:[
  {date:'2026-11-09',level:'Borong',state:'',price:1,markets:2},
  {date:'2026-11-10',level:'Borong',state:'',price:2,markets:3},
  {date:'2026-11-11',level:'Borong',state:'',price:3,markets:3},
  {date:'2026-11-13',level:'Borong',state:'',price:4,markets:4},
  {date:'2026-11-13',level:'Runcit',state:'',price:70,markets:1}
 ]};
 const v=observedStreak(history,{level:'Borong',state:'',endDate:'2026-11-13'});
 assert.equal(v.count,3);
 assert.equal(v.direction,'rise');
 assert.match(v.warning,/不同调查日可能使用不同市场/);
 assert.equal(observedStreak(history,{level:'Runcit'}).count,0);
});
test('V3.4 stores edits, lifecycle, metrics and optional published URLs without changing source prices',()=>{
 const base=emptyWorkspace();
 const metrics=normalizeMetrics({reach:'1200',likes:60,comments:20,shares:8,messages:6,joins:3,orders:1});
 const record={
  id:'post-a',createdAt:'2026-11-13T08:00:00Z',updatedAt:'2026-11-13T08:00:00Z',
  status:'published',channel:'facebook',language:'bm',format:'discussion',
  title:'Harga TIMUN',body:'A real survey excerpt',
  scheduledDate:'2026-11-13',postedDate:'2026-11-13',
  postUrl:'https://www.facebook.com/post/123',notes:'follow up',metrics,evidenceDate:'2026-11-13',
  evidence:{product:'TIMUN',percent:8}
 };
 const saved=saveRecord(base,record);
 assert.equal(saved.records.length,1);
 assert.equal(saved.records[0].metrics.reach,1200);
 assert.equal(readWorkspace(JSON.stringify(saved)).records[0].evidence.product,'TIMUN');
 assert.equal(contentMetrics(saved).messages,6);
 assert.equal(contentMetrics(saved).orders,1);
 assert.equal(contentMetrics(saved).published,1);
 const edited=saveRecord(saved,{...record,title:'Updated TIMUN',status:'draft',metrics});
 assert.equal(edited.records.length,1);
 assert.equal(edited.records[0].title,'Updated TIMUN');
 assert.equal(contentMetrics(edited).reach,0,'draft metrics must not inflate published totals');
 assert.match(toCSV(saved),/Harga TIMUN/);
 assert.match(toCSV(saved),/"published"/);
 assert.equal(isValidISODate('2026-02-30'),false);
 assert.equal(isValidISODate('2026-11-13'),true);
});
test('V3.4 rejects bad backups, duplicate IDs, invalid statuses and unsafe links',()=>{
 const r={id:'1',createdAt:'2026',updatedAt:'2026',
  status:'draft',channel:'facebook',language:'bm',format:'discussion',
  title:'T',body:'B',metrics:{}};
 assert.throws(()=>readWorkspace({schema:'wrong',records:[]}),/不是受支持/);
 assert.throws(()=>readWorkspace({schema:WORKSPACE_SCHEMA,records:[r,r]}),/重复 ID/);
 assert.throws(()=>saveRecord(emptyWorkspace(),{...r,status:'pending'}),/状态无效/);
 assert.throws(()=>saveRecord(emptyWorkspace(),{...r,postUrl:'javascript:alert(1)'}),/HTTPS/);
 assert.throws(()=>saveRecord(emptyWorkspace(),{...r,scheduledDate:'2026-02-30'}),/日期无效/);
});

test('all draft formats preserve verified prices, grade, dates, price level and local scope',()=>{
 const data=row('TIMUN HIJAU','Ladang',25,{was:2,state:'PERAK'});
 const s=findContentSignals([data],{region:'PERAK'})[0];
 for(const format of FORMATS){
   const opts={format,language:'both',settings:{showSource:false,mentionPage:true,inviteFollow:true,
     mentionWhatsApp:true,commentKeyword:true,networking:true}};
   const draft=composeCreatorDraft(s,opts);
   for(const value of ['RM2.00/kg','RM2.50/kg','+RM0.50/kg','+25.0%','F.A.Q','PERAK',
     '2026-11-06','2026-11-13','15 pasaran yang sama','SKY AGRO','WhatsApp','NAK','Siputeh'])
     assert.ok(draft.body.includes(value),format+' missing '+value);
   assert.doesNotMatch(draft.body,/FAMA|seluruh Malaysia|全国|bincang angka ni dengan bos/);
   assert.equal(validateCreatorDraft(draft,s,opts).valid,true);
 }
 const confirmed=composeCreatorDraft(s,{settings:{confirmedConversation:true}});
 assert.match(confirmed.body,/Saya ada bincang angka ni dengan bos SKY AGRO/);
 assert.equal(findContentSignals([row('TIMUN','Ladang',25,{markets:1})]).length,0);
 const fallback=row('TIMUN','Ladang',25,{was:2});
 fallback.changes[7].previousDate='2026-11-04';
 fallback.changes[7].actualDays=9;
 const draft=composeCreatorDraft(findContentSignals([fallback])[0]);
 assert.match(draft.body,/2026-11-04 \(selang 9 hari\)/);
});

test('copy validation rejects edited claims, scope, invented causes and fake testimony',()=>{
 const s=findContentSignals([row('TIMUN','Ladang',25,{was:2,state:'PERAK'})],{region:'PERAK'})[0];
 const original=composeCreatorDraft(s);
 for(const [before,after] of [['RM2.00','RM2.01'],['RM2.50','RM7.50'],['RM0.50','RM5.50'],
   ['+25.0%','+50.0%'],['15 pasaran','1 pasaran'],['PERAK','seluruh Malaysia'],['ladang','runcit'],
   ['2026-11-06','2026-11-05'],['F.A.Q','Gred A']]){
   assert.equal(validateCreatorDraft({...original,body:original.body.replace(before,after)},s).valid,false,before);
 }
 assert.equal(validateCreatorDraft({...original,title:'HARGA TIMUN NAIK 50%'},s).valid,false);
 for(const added of ['Petani pasti untung.', 'Harga naik kerana banjir.', 'Bos SKY AGRO beritahu saya.']){
   assert.equal(validateCreatorDraft({...original,body:original.body+'\n\n'+added},s).valid,false);
 }
 const reordered=original.body.split('\n\n').filter(p=>!p.startsWith('Harga kat tempat')).reverse().join('\n\n');
 assert.equal(validateCreatorDraft({...original,body:reordered},s).valid,true);
 assert.equal(validateCreatorDraft(original,s,{settings:{showSource:false}}).valid,false);
 assert.throws(()=>composeCreatorDraft({...s,currentMean:99}),/不完整或不一致/);
});

test('direction filters use independent levels and state spreads require same survey and comparable samples',()=>{
 const levels=[row('SAWI','Ladang',-8),row('SAWI','Borong',20),row('SAWI','Runcit',-12)];
 assert.equal(findContentSignals(levels,{type:'fall'})[0].level,'Runcit');
 assert.equal(findContentSignals(levels,{type:'fall',level:'Ladang'})[0].level,'Ladang');
 assert.equal(findContentSignals(levels,{type:'rise'})[0].level,'Borong');
 const audit=findContentSignals([...levels.slice(0,2),row('SAWI','Runcit',-90)],{type:'audit'})[0];
 assert.equal(audit.level,'Runcit');
 assert.equal(audit.percent,-90);
 assert.equal(audit.publishable,false);
 const state=(name,level,price,markets)=>({...row('TIMUN',level,10,{state:name}),price,markets});
 const quotes=[state('PERAK','Ladang',2,4),state('KEDAH','Ladang',3,5),
   state('SELANGOR','Runcit',8,8),state('PAHANG','Ladang',90,1)];
 const [spread]=statePriceSpreads(quotes,{region:'PERAK'});
 assert.equal(spread.low.state,'PERAK');
 assert.equal(spread.high.state,'KEDAH');
 assert.equal(spread.difference,1);
 assert.equal(statePriceSpreads(quotes).length,1);
 assert.deepEqual(statePriceSpreads(quotes.map(q=>q.state==='KEDAH'?{...q,priceReview:true}:q)),[]);
});

test('tier alignment and divergence require identical comparison dates',()=>{
 const quotes=[row('SAWI','Ladang',-8),row('SAWI','Borong',-10),row('SAWI','Runcit',-12)];
 assert.equal(findContentSignals(quotes,{type:'aligned'}).length,1);
 const retail=quotes[2].changes[7];
 retail.previousDate='2026-11-05';
 retail.actualDays=8;
 assert.deepEqual(findContentSignals(quotes,{type:'aligned'}),[]);
 retail.percent=12;
 retail.current=retail.previous*1.12;
 retail.rmDifference=retail.current-retail.previous;
 assert.deepEqual(findContentSignals(quotes,{type:'divergent'}),[]);
});

test('a source anomaly in an otherwise eligible comparison blocks content',()=>{
 const quote=row('SAWI','Ladang',-8);
 quote.changes[7].reviewReasons=['source-price'];
 const [audit]=findContentSignals([quote],{type:'audit'});
 assert.equal(audit.percent,-8);
 assert.deepEqual(audit.reviewReasons,['source-price']);
 assert.equal(audit.publishable,false);
 assert.throws(()=>composeCreatorDraft(audit),/缺少可发布/);
 const state={...quote,state:'PERAK',priceReview:true,price:80,markets:1};
 assert.deepEqual(sourceReviewQuotes([state],{query:'SAWI',level:'Ladang'}),[state]);
 assert.deepEqual(sourceReviewQuotes([state],{region:'KEDAH'}),[]);
});
