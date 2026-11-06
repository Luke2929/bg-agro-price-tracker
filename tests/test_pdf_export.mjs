import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildFamaPdf,canonicalPdfRows,pdfPriceRanges} from '../site/pdf.mjs';
import {parseCSV} from '../site/v3/engine.mjs';

const sample=(values={})=>({priceid:'1',tarikh_harga:'2026-11-06',negeri:'PERAK',
  daerah:'KINTA',lokasi:'PASAR BESAR IPOH',peringkat:'Runcit',kategori:'Sayur-Sayuran',
  varieti:'BAYAM',gred:'F.A.Q',unit:'Kilogram',harga:'6.00',...values});

test('PDF source revision handling is date-specific and latest in original CSV order',()=>{
  const rows=[sample({priceid:'10',harga:'1.00'}),sample({priceid:'10',harga:'2.00'}),
    sample({priceid:'11',harga:''}),sample({priceid:'12',harga:'4.00',tarikh_harga:'2026-11-05'})];
  const latest=canonicalPdfRows(rows,{'2026-11-06':['11']});
  assert.equal(latest.length,2);
  assert.equal(latest[0].harga,'2.00');
  assert.equal(latest[1].tarikh_harga,'2026-11-05');
});

test('PDF ranges preserve level, grade, and unit without zero-filling missing prices',()=>{
  const groups=pdfPriceRanges([
    sample({harga:'3.00',peringkat:'Ladang'}),
    sample({harga:'6.00',peringkat:'Runcit'}),
    sample({harga:'',peringkat:'Borong'}),
    sample({harga:'20.00',unit:'Biji'}),
    sample({harga:'99.00',gred:'A'})
  ]);
  assert.equal(groups.length,3);
  const kg=groups.find(x=>x.unit==='Kilogram'&&x.gred==='F.A.Q');
  assert.equal(kg.levels.Ladang.min,3);
  assert.equal(kg.levels.Runcit.max,6);
  assert.equal(kg.levels.Borong,undefined);
});

test('quick PDF has four mobile pages, true source values, and clickable document catalog',()=>{
  const rows=[sample({priceid:'100',peringkat:'Ladang',harga:'2.30'}),
    sample({priceid:'101',peringkat:'Runcit',harga:'6.00'})];
  const bytes=buildFamaPdf(rows,{type:'quick',from:'2026-11-06',to:'2026-11-06'});
  const pdf=new TextDecoder().decode(bytes);
  assert.match(pdf,/^%PDF-1\.4/);
  assert.match(pdf,/\/Count 4/);
  assert.match(pdf,/\/Subtype \/Link/);
  assert.match(pdf,/\/Outlines/);
  assert.match(pdf,/RM 2\.30/);
  assert.match(pdf,/RM 6\.00/);
  assert.doesNotMatch(pdf,/BG Agro/);
});

test('full PDF has survey date, state, district, and market navigation and raw price IDs',()=>{
  const rows=[sample({priceid:'123',harga:'6.00'}),
    sample({priceid:'124',harga:''})];
  const bytes=buildFamaPdf(rows,{type:'full',from:'2026-11-06',to:'2026-11-06'});
  const pdf=new TextDecoder().decode(bytes);
  for(const value of ['PASAR BESAR IPOH','PERAK','KINTA','123','124'])assert.ok(pdf.includes(value),value);
  assert.match(pdf,/\/Outlines/);
  assert.match(pdf,/\/Dest \[/);
  assert.match(pdf,/harga kosong dikekalkan/);
});

test('multi-day PDF keeps dates in separate chapters instead of combining survey quotes',()=>{
  const rows=[sample({priceid:'101',harga:'2.00',tarikh_harga:'2026-11-05'}),
    sample({priceid:'102',harga:'6.00',tarikh_harga:'2026-11-06'})];
  const pdf=new TextDecoder().decode(buildFamaPdf(rows,{type:'full',from:'2026-11-05',to:'2026-11-06'}));
  assert.match(pdf,/NEGERI \/ WILAYAH - 2026-11-05/);
  assert.match(pdf,/NEGERI \/ WILAYAH - 2026-11-06/);
  assert.match(pdf,/RM 2\.00/);
  assert.match(pdf,/RM 6\.00/);
});

test('both dashboards have working PDF buttons, neutral public branding, and shared theme',()=>{
  for(const version of ['v3','v3.1']){
    const html=readFileSync(new URL(`../site/${version}/index.html`,import.meta.url),'utf8');
    const code=readFileSync(new URL(`../site/${version}/app.mjs`,import.meta.url),'utf8');
    assert.doesNotMatch(html,/BG Agro|Luke Ng/i);
    assert.match(html,/assets\/official-theme\.css/);
    for(const id of ['export-pdf-quick','export-pdf-full']){
      assert.match(html,new RegExp(`id="${id}"`));
      assert.match(code,new RegExp(`\\$\\('${id}'\\)\\.addEventListener`));
    }
    assert.match(code,/buildFamaPdf\(records,/);
  }
});

test('real FAMA CSV generates both PDF variants without synthetic observations',()=>{
  const rows=parseCSV(readFileSync(new URL('../data/daily/2026-11-06.csv',import.meta.url),'utf8'));
  assert.ok(rows.length>1000);
  const options={from:'2026-11-06',to:'2026-11-06'};
  assert.ok(buildFamaPdf(rows,{...options,type:'quick'}).length>6000);
  assert.ok(buildFamaPdf(rows,{...options,type:'full'}).length>50000);
});
