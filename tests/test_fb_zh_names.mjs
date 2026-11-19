import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translateVegetableZH, untranslatedVegetables, ZH_VEGETABLE_DICTIONARY_SIZE} from '../site/v3.1/fb-zh-names.mjs';

const catalog=JSON.parse(readFileSync(new URL('../site/data/catalog.json', import.meta.url),'utf8'));
const veg=[...new Set(catalog.products.filter(p=>p.kategori==='Sayur-Sayuran').map(p=>p.name))];

test('All archived FAMA vegetable varieties have verified Chinese names',()=>{
  assert.ok(veg.length>0);
  assert.deepEqual(untranslatedVegetables(veg),[], 'No raw Malay vegetables may silently remain untranslated');
  assert.ok(ZH_VEGETABLE_DICTIONARY_SIZE>=veg.length);
  for(const raw of veg){
    const translated=translateVegetableZH(raw);
    assert.ok(translated && /[\u3400-\u9FFF]/u.test(translated),raw+' has no Chinese label');
  }
});

test('Chinese names retain source variety identity without unexpected collisions',()=>{
  const grouped=new Map();
  for(const name of veg){
    const zh=translateVegetableZH(name);
    if(!grouped.has(zh))grouped.set(zh,[]);
    grouped.get(zh).push(name);
  }
  const collisions=[...grouped].filter(([,raw])=>raw.length>1);
  assert.deepEqual(collisions,[], 'Different FAMA varieties must not collapse to identical Chinese labels');
});

test('Wrong prefix translations, imported variants and highland indicators are corrected',()=>{
  const expected={
    'KUBIS BUNGA (IMPORT)':'进口花椰菜',
    'KUBIS BULAT (CHINA)':'圆包菜（中国）',
    'KUBIS PANJANG / CINA':'大白菜',
    'SAWI JEPUN':'日本小白菜',
    'SAWI BUNGA':'菜心（花型）',
    'CILI HIJAU (IMPORT)':'进口青辣椒',
    'TIMUN JEPUN':'日本青瓜',
    'TOMATO (TANAH TINGGI)':'高地番茄',
    'KACANG BOTOR':'四棱豆',
    'LIK':'韭葱',
    'POH CHOY':'菠菜'
  };
  for(const [source,zh] of Object.entries(expected))assert.equal(translateVegetableZH(source),zh,source);
});

test('Unknown future FAMA names are flagged for review, not mislabeled',()=>{
  assert.equal(translateVegetableZH('SAYUR UNKNOWN FUTURE VARIETY'),null);
  assert.deepEqual(untranslatedVegetables(['BAYAM','SAYUR UNKNOWN FUTURE VARIETY']),['SAYUR UNKNOWN FUTURE VARIETY']);
});
