// SKY AGRO Chinese vegetable name dictionary. All entries are exact FAMA varieti identities.
// Audit baseline: site/data/catalog.json · Sayur-Sayuran · 133 unique names (19 Nov 2026).
// Only the display label is translated; NEVER modify grouping keys, grades, unit, source or price.
// For unfamiliar names, return null so Chinese export explicitly fails instead of
// silently printing an untranslated Malay label or inventing a translation.
// Some locally named ulam/cultivar identifiers are intentionally retained for precision.
const LABELS = new Map(`
ASPARAGUS (IMPORT)|进口芦笋
BAWANG BESAR KUNING / HOLLAND|黄洋葱（荷兰型）
BAWANG BESAR MERAH (CHINA)|红洋葱（中国）
BAWANG BESAR MERAH (IMPORT)|进口红洋葱
BAWANG BESAR MERAH (INDIA)|红洋葱（印度）
BAWANG BESAR MERAH (PAKISTAN)|红洋葱（巴基斯坦）
BAWANG MERAH / KECIL (IMPORT)|进口小红葱头
BAWANG MERAH / KECIL (INDIA)|小红葱头（印度）
BAWANG MERAH / KECIL (PAKISTAN)|小红葱头（巴基斯坦）
BAWANG MERAH / KECIL (THAI)|小红葱头（泰国）
BAWANG MERAH ROSE|红葱头（Rose品种）
BAWANG PUTIH (CHINA)|大蒜（中国）
BAYAM|苋菜
BELIMBING BULUH|酸杨桃
BROKOLI|西兰花
BROKOLI (IMPORT)|进口西兰花
BUNGA KANTAN|火炬姜花
BUNGA KANTAN (IMPORT)|进口火炬姜花
CENDAWAN TIRAM KELABU|灰平菇
CILI / LADA SOLOK|Solok辣椒
CILI HIJAU|青辣椒
CILI HIJAU (IMPORT)|进口青辣椒
CILI MERAH (CHINA)|红辣椒（中国）
CILI MERAH (IMPORT)|进口红辣椒
CILI MERAH (THAILAND)|红辣椒（泰国）
CILI MERAH (VIETNAM)|红辣椒（越南）
CILI MERAH KULAI / KULAI HIBRID|红辣椒（Kulai／杂交）
CILI MERAH MINYAK|红辣椒（Minyak品种）
CILI PADI|小米椒
CILI PADI AKAR (THAILAND)|小辣椒（Akar型／泰国）
CILI PADI KAMPUNG (THAILAND)|小米椒（Kampung型／泰国）
CILI PADI MERAH (IMPORT)|进口红小米椒
DAUN BAWANG|青葱
DAUN BAWANG (IMPORT)|进口青葱
DAUN KESUM|叻沙叶
DAUN KETUMBAR (IMPORT)|进口香菜叶
DAUN SELOM|水芹
DAUN SUP (IMPORT)|进口芹菜叶
DAUN SUP (TANAH TINGGI)|高地芹菜叶
HALIA MUDA|嫩姜
HALIA MUDA (IMPORT)|进口嫩姜
HALIA TUA|老姜
HALIA TUA (IMPORT)|进口老姜
HALIA TUA BENTONG|文冬老姜
JAGUNG SAYUR / BABY CORN|玉米笋
JERING|杰灵豆（Jering）
KACANG BENDI|羊角豆
KACANG BENDI (IMPORT)|进口羊角豆
KACANG BOTOR|四棱豆
KACANG BUNCIS|四季豆
KACANG BUNCIS (IMPORT)|进口四季豆
KACANG PANJANG (IMPORT)|进口长豆
KACANG PANJANG HIJAU|青长豆
KACANG PANJANG HIJAU (IMPORT)|进口青长豆
KAILAN|芥兰
KAILAN (IMPORT)|进口芥兰
KANGKUNG|空心菜
KANGKUNG (IMPORT)|进口空心菜
KELADI|芋头
KETOLA / PETOLA SEGI|有棱丝瓜
KETOLA / PETOLA SEGI (IMPORT)|进口有棱丝瓜
KUBIS BULAT (CHINA)|圆包菜（中国）
KUBIS BULAT (INDONESIA)|圆包菜（印尼）
KUBIS BULAT (TANAH TINGGI)|高地圆包菜
KUBIS BULAT BEIJING (IMPORT)|进口北京型圆包菜
KUBIS BUNGA (IMPORT)|进口花椰菜
KUBIS PANJANG / CINA|大白菜
KUBIS PANJANG / CINA (IMPORT)|进口大白菜
KUBIS PANJANG MINI / PICAI CINA|迷你大白菜（Picai Cina型）
KUBIS PANJANG SILINDER / PICAI|圆筒大白菜（Picai型）
KUNDUR BULAT|圆冬瓜
KUNYIT|黄姜
LABU AIR|葫芦瓜
LABU MANIS|南瓜
LADA BENGGALA / CAPSICUM HIJAU|青甜椒
LADA BENGGALA / CAPSICUM HIJAU (IMPORT)|进口青甜椒
LADA BENGGALA / CAPSICUM KUNING|黄甜椒
LADA BENGGALA / CAPSICUM KUNING (IMPORT)|进口黄甜椒
LADA BENGGALA / CAPSICUM MERAH|红甜椒
LADA BENGGALA / CAPSICUM MERAH (IMPORT)|进口红甜椒
LADA PUTIH SABAH|沙巴白胡椒
LENGKUAS|南姜
LIK|韭葱
LIK (IMPORT)|进口韭葱
LIMAU KASTURI|酸柑
LIMAU NIPIS|青柠檬
LOBAK MERAH (CHINA)|胡萝卜（中国）
LOBAK PUTIH TANAH TINGGI|高地白萝卜
PEGAGA|雷公根
PERIA|苦瓜
PERIA KATAK|山苦瓜
PETAI|臭豆（Petai）
POH CHOY|菠菜
PUCUK GAJUS|腰果嫩叶
PUCUK MAMAN|Maman野菜嫩叶
PUCUK PAKU|野蕨菜
REBUNG|竹笋
SALAD|生菜
SALAD (IMPORT)|进口生菜
SALAD BULAT TANAH TINGGI|高地球生菜
SAWI BUNGA|菜心（花型）
SAWI HIJAU|青菜心
SAWI HIJAU (IMPORT)|进口青菜心
SAWI HIJAU (TANAH RENDAH)|低地青菜心
SAWI HIJAU TANAH TINGGI|高地青菜心
SAWI JEPUN|日本小白菜
SAWI PAHIT|苦芥菜
SAWI PUTIH PAK CHOY|小白菜（白梗）
SELADA AIR/WATER CRESS|西洋菜
SELASIH|罗勒
SENGKUANG|沙葛
SERAI|香茅
TAUGE|豆芽
TENGGEK BURUNG|Tenggek Burung野菜
TERUNG ASAM|酸茄（Terung Asam）
TERUNG BULAT|圆茄子
TERUNG PANJANG / PEPARU (IMPORT)|进口长茄子（Peparu型）
TERUNG PANJANG / PEPARU (TANAH RENDAH)|低地长茄子（Peparu型）
TERUNG PEPARU MINI|迷你茄子（Peparu型）
TERUNG PEPARU PANJANG TANAH TINGGI|高地长茄子（Peparu型）
TERUNG PIPIT|小野茄（Turkey Berry）
TERUNG TELUNJUK|手指茄
TIMUN HIJAU|青瓜
TIMUN HIJAU (IMPORT)|进口青瓜
TIMUN JEPUN|日本青瓜
TOMATO (TANAH TINGGI)|高地番茄
TOMATO IMPORT|进口番茄
TOMATO PLUM (TANAH TINGGI)|高地李子型番茄
TOMATO TANAH RENDAH|低地番茄
TONG HO|茼蒿
UBI KENTANG (IMPORT)|进口马铃薯
UBI KENTANG HOLLAND|荷兰型马铃薯
ULAM RAJA|帝皇菜（Ulam Raja）
`.trim().split('\n').map(line => {
  const p=line.indexOf('|');
  return [line.slice(0,p).trim(),line.slice(p+1).trim()];
}));
const key = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
export function translateVegetableZH(value) {
  return LABELS.get(key(value)) || null;
}
export function untranslatedVegetables(values) {
  return [...new Set(values.map(key).filter(name => name && !LABELS.has(name)))].sort();
}
export const ZH_VEGETABLE_DICTIONARY_SIZE = LABELS.size;
