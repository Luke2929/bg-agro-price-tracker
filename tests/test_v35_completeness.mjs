import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeSurvey,compareSurveys,sourceAudit,MALAYSIA_STATES}
  from '../site/v3.1/completeness.mjs';

function row(id,day,state,district,location,variety,level='Ladang',price='2',grade='F.A.Q') {
  return {priceid:String(id),tarikh_harga:day,negeri:state,daerah:district,
    lokasi:location,peringkat:level,varieti:variety,gred:grade,unit:'Kilogram',harga:price};
}

test('counts valid original observations, districts, markets and price levels separately',()=>{
  const rows=[
    row(1,'2026-11-13','PERAK','KINTA','MARKET A','TIMUN HIJAU','Ladang','2'),
    row(2,'2026-11-13','PERAK','KINTA','MARKET A','TIMUN HIJAU','Borong','3'),
    row(3,'2026-11-13','PERAK','KINTA','MARKET A','TIMUN HIJAU','Runcit','4'),
    row(4,'2026-11-13','PERAK','KINTA','MARKET A','TIMUN HIJAU','Runcit',''),
    row(5,'2026-11-13','PERAK','KINTA','MARKET A','TIMUN HIJAU','Unknown','5'),
    row(6,'2026-11-13','PERAK','KINTA','MARKET B','TIMUN HIJAU','Runcit','5')
  ];
  const v=summarizeSurvey(rows);
  assert.equal(v.rawRecords,6);
  assert.equal(v.validRecords,4);
  assert.deepEqual(v.states,['PERAK']);
  assert.equal(v.districts.length,1);
  assert.equal(v.locations.length,2);
  assert.equal(v.items.length,3); // one district-product-level combination per level
  assert.deepEqual(v.byLevel,{Ladang:1,Borong:1,Runcit:2});
});

test('reports state, district, location and exact item-grade-level disappearance',()=>{
  const prev=summarizeSurvey([
    row(1,'2026-11-13','PERAK','KINTA','A','TIMUN HIJAU','Ladang'),
    row(2,'2026-11-13','PERAK','KINTA','A','TIMUN HIJAU','Borong'),
    row(3,'2026-11-13','SELANGOR','KLANG','B','SAWI HIJAU','Borong')
  ]);
  const now=summarizeSurvey([row(4,'2026-11-14','PERAK','KINTA','A','TIMUN HIJAU','Borong')]);
  const diff=compareSurveys(now,prev);
  assert.equal(diff.missingStates.length,15);
  assert(diff.missingStates.includes('SELANGOR'));
  assert.deepEqual(diff.vanishedStates,['SELANGOR']);
  assert.deepEqual(diff.vanishedDistricts,[{state:'SELANGOR',district:'KLANG'}]);
  assert.deepEqual(diff.vanishedLocations,[{state:'SELANGOR',district:'KLANG',location:'B'}]);
  assert(diff.vanishedItems.some(x=>x.variety==='TIMUN HIJAU'&&x.level==='Ladang'));
  assert(diff.vanishedItems.some(x=>x.variety==='SAWI HIJAU'&&x.level==='Borong'));
  assert(!diff.vanishedItems.some(x=>x.variety==='TIMUN HIJAU'&&x.level==='Borong'));
});

test('honours canonical latest priceid and cross-date exclusion without inventing quotes',()=>{
  const prev=summarizeSurvey([
    row(42,'2026-11-13','PERAK','KINTA','A','TIMUN HIJAU','Ladang'),
    row(42,'2026-11-13','PERAK','KINTA','A','TIMUN HIJAU','Ladang','3'),
    row(51,'2026-11-13','PERAK','KINTA','A','SAWI HIJAU','Runcit')
  ],['51']);
  assert.equal(prev.rawRecords,3);
  assert.equal(prev.canonicalRecords,1);
  assert.equal(prev.validRecords,1);
  assert.equal(prev.items.length,1);
  const diff=compareSurveys(prev,null);
  assert.equal(diff.comparable,false);
  assert.deepEqual(diff.vanishedItems,[]);
});

test('verifies only the upstream count and matching CSV fingerprint, never total market coverage',()=>{
  const day='2026-11-14',hash='a'.repeat(64);
  const audit={dates:{[day]:{expected:2458,fetched:2458,archive_rows:2458,csv_sha256:hash}}};
  assert.equal(sourceAudit(day,audit,{[day]:'aaaaaaaaaaaaaaaa'}).code,'verified');
  assert.equal(sourceAudit(day,audit,{[day]:'bbbbbbbbbbbbbbbb'}).code,'stale');
  assert.equal(sourceAudit('2026-11-13',audit,{}).code,'unknown');
  assert.equal(sourceAudit(day,{dates:{[day]:{...audit.dates[day],fetched:100}}},{}).code,'stale');
  assert.equal(MALAYSIA_STATES.length,16);
});

test('overview exposes date-range inputs, explicit provenance and all missing-data scopes',()=>{
  const html=readFileSync(new URL('../site/v3.1/index.html',import.meta.url),'utf8');
  for(const name of ['completeness-start','completeness-end','completeness-analyze',
    'completeness-results','completeness-export','completeness-timeline',
    'completeness-state','completeness-provenance'])assert(html.includes('id="'+name+'"'));
  for(const tab of ['states','districts','locations','items'])
    assert(html.includes('data-completeness-tab="'+tab+'"'));
});
