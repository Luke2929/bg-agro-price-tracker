import test from 'node:test';
import assert from 'node:assert/strict';
import {
 WORKSPACE_SCHEMA,emptyWorkspace,readWorkspace,saveRecord,contentMetrics,toCSV,
 isValidISODate,findContentSignals,scoreOpportunity,composeCreatorDraft,
 observedStreak,normalizeMetrics
} from '../site/v3.1/creator-core.mjs';

const row=(name,level,pct,opt={})=>({
 product_key:name+'||F.A.Q||Kilogram',varieti:name,gred:'F.A.Q',
 unit:'Kilogram',level,state:opt.state||'',kategori:opt.kategori||'Sayur-Sayuran',
 date:'2026-11-13',changes:{
  7:{eligible:opt.eligible!==false,percent:pct,markets:opt.markets??15,
    currentCoverage:opt.coverage??0.88,previousCoverage:opt.coverage??0.9,
    previousDate:'2026-11-06',currentDate:'2026-11-13',
    current:opt.now??7,previous:opt.was??6},
  30:{eligible:opt.eligible!==false,percent:pct,markets:opt.markets??14,
    currentCoverage:0.9,previousCoverage:0.9,
    previousDate:'2026-10-14',currentDate:'2026-11-13'}
 }
});
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
 assert.match(bm.body,/tidak membuktikan untung/);
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
