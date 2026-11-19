import {parseCSV,canonicalDailyRows,validPrice} from './engine.mjs?rev=v3-5-completeness-1';

const RAW = 'https://raw.githubusercontent.com/Luke2929/bg-agro-price-tracker/master/data/daily/';
const $ = id => document.getElementById(id);
const STATES = [
  ['JOHOR','Johor','柔佛'],['KEDAH','Kedah','吉打'],['KELANTAN','Kelantan','吉兰丹'],
  ['MELAKA','Melaka','马六甲'],['NEGERI SEMBILAN','Negeri Sembilan','森美兰'],
  ['PAHANG','Pahang','彭亨'],['PERAK','Perak','霹雳'],
  ['PERLIS','Perlis','玻璃市'],['PULAU PINANG','Pulau Pinang','槟城'],
  ['SABAH','Sabah','沙巴'],['SARAWAK','Sarawak','砂拉越'],
  ['SELANGOR','Selangor','雪兰莪'],['TERENGGANU','Terengganu','登嘉楼'],
  ['W.P. KUALA LUMPUR','Kuala Lumpur','吉隆坡'],
  ['W.P. PUTRAJAYA','Putrajaya','布城'],['W.P. LABUAN','Labuan','纳闽']
];
const NAMES = [
  ['CILI MERAH KULAI','红辣椒（Kulai）'],['CILI MERAH MINYAK','红辣椒（Minyak）'],
  ['CILI HIJAU','青辣椒'],['CILI / LADA SOLOK','Solok 辣椒'],
  ['TIMUN HIJAU','青瓜'],['KACANG PANJANG HIJAU','长豆'],
  ['KACANG BENDI','羊角豆'],['KACANG BUNCIS','四季豆'],
  ['TERUNG PANJANG','长茄子'],['SAWI HIJAU TANAH TINGGI','高地芥菜'],
  ['SAWI HIJAU','芥菜'],['BAYAM','苋菜'],['KANGKUNG','空心菜'],
  ['KUBIS BULAT','包菜'],['KOBIS BULAT','包菜'],['KOBIS BUNGA','花椰菜'],
  ['TOMATO PLUM','李子型番茄'],['TOMATO','番茄'],
  ['LABU MANIS','南瓜'],['DAUN BAWANG','葱叶'],['DAUN SUP','芹菜叶'],
  ['SALAD','生菜'],['KUBIS','包菜']
];
const FEATURED = [
  'CILI MERAH','TIMUN','SAWI','KACANG PANJANG','BAYAM','KANGKUNG',
  'TERUNG','KACANG BENDI','TOMATO','KUBIS','KOBIS','CILI HIJAU'
];
const LEVEL_LABELS = {
  Ladang:['Harga Ladang (L)','农场价 (L)'],
  Borong:['Harga Borong (B)','批发价 (B)'],
  Runcit:['Harga Runcit (R)','零售价 (R)']
};
const BY_DATE = new Map();
const PER_PAGE = 18;
const WIDTH = 1080, HEIGHT = 1350;
let meta = null;
let busy = false;
let previewData = null;
let previewIndex = 0;

function stateName(key,lang) {
  const found=STATES.find(s=>s[0]===key);
  return found ? found[lang==='zh'?2:1] : key;
}
function translateProduct(v) {
  const source=String(v||'').trim().toUpperCase();
  const found=NAMES.find(([prefix])=>source.startsWith(prefix));
  return found ? found[1] : source;
}
function unitLabel(v,lang) {
  const key=String(v||'').trim().toLowerCase();
  const bm={kilogram:'kg',gram:'g',ikat:'ikat',biji:'biji',ekor:'ekor',pek:'pek'};
  const zh={kilogram:'公斤',gram:'克',ikat:'束',biji:'粒',ekor:'只',pek:'包'};
  return (lang==='zh'?zh:bm)[key]||String(v||'unit');
}
function money(v){return Number(v).toFixed(2);}
function dataKey(row){
  return JSON.stringify([String(row.varieti).trim(),String(row.gred).trim(),String(row.unit).trim()]);
}
function buildGroups(rows,date,level) {
  const groups=new Map();
  for(const row of canonicalDailyRows(rows,meta?.superseded_priceids?.[date]||[])) {
    if(String(row.kategori||'').trim().toLowerCase()!=='sayur-sayuran' ||
       String(row.peringkat||'').trim()!==level)continue;
    const price=validPrice(row.harga);
    if(price===null||price<=0||!String(row.varieti||'').trim())continue;
    const state=String(row.negeri||'').trim();
    if(!groups.has(state))groups.set(state,new Map());
    const bucket=groups.get(state), key=dataKey(row);
    if(!bucket.has(key))bucket.set(key,{varieti:String(row.varieti).trim(),gred:String(row.gred).trim(),
      unit:String(row.unit).trim(),min:price,max:price,count:0,markets:new Set()});
    const item=bucket.get(key);
    item.min=Math.min(item.min,price);item.max=Math.max(item.max,price);item.count++;
    item.markets.add(JSON.stringify([row.daerah,row.lokasi,row.sublevel]));
  }
  return groups;
}
function pickProducts(groups,state,mode) {
  let items=[...(groups.get(state)?.values()||[])];
  items.sort((a,b)=>a.varieti.localeCompare(b.varieti,'ms')||a.gred.localeCompare(b.gred,'ms'));
  if(mode==='popular'){
    items.sort((a,b)=>{
      const rank=x=>{const i=FEATURED.findIndex(s=>x.varieti.toUpperCase().startsWith(s));return i<0?999:i;};
      return rank(a)-rank(b)||b.count-a.count||a.varieti.localeCompare(b.varieti);
    });
    items=items.slice(0,12);
  }
  return items;
}
function paginate(items) {
  if(!items.length)return [[]];
  const pages=[];
  for(let i=0;i<items.length;i+=PER_PAGE)pages.push(items.slice(i,i+PER_PAGE));
  return pages;
}
async function getArchive() {
  if(meta)return meta;
  const response=await fetch('../data/meta.json?fb='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('无法读取 FAMA 存档目录 ('+response.status+')');
  const info=await response.json();
  if(!Array.isArray(info.archive_dates)||!info.archive_dates.length)throw Error('FAMA 存档日期清单无效');
  meta=info;return meta;
}
async function getDate(date) {
  if(!meta?.archive_dates?.includes(date))throw Error('所选日期没有归档 CSV，不能用旧数据代替');
  if(!BY_DATE.has(date)) {
    const pending=(async()=>{
      const response=await fetch(RAW+encodeURIComponent(date)+'.csv',{cache:'no-store'});
      if(!response.ok)throw Error(date+' 的原始 CSV 下载失败 ('+response.status+')');
      const raw=await response.text();
      const rows=parseCSV(raw,date); // All 17 columns and each survey date are validated.
      if(!rows.length)throw Error('该日期 CSV 没有有效记录');
      return rows;
    })();
    BY_DATE.set(date,pending);
    pending.catch(()=>{if(BY_DATE.get(date)===pending)BY_DATE.delete(date);});
  }
  return BY_DATE.get(date);
}
function setStatus(message,isError=false) {
  const el=$('fb-post-status');
  el.textContent=message;el.classList.toggle('fb-post-error',isError);
}
function values() {
  return {date:$('fb-post-date').value,state:$('fb-post-state').value,
    level:$('fb-post-level').value,language:$('fb-post-language').value,
    mode:$('fb-post-mode').value};
}
function setBusy(flag) {
  busy=flag;
  for(const id of ['fb-post-preview','fb-post-single','fb-post-zip','fb-post-copy',
    'fb-post-date','fb-post-state','fb-post-level','fb-post-language','fb-post-mode'])
    $(id).disabled=flag;
  updateGalleryControls();
}
function roundRect(ctx,x,y,w,h,r,color) {
  ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();
}
function textFit(ctx,text,x,y,maxWidth,size,min=15) {
  let s=size;
  while(s>min) {
    ctx.font='700 '+s+'px Arial, "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
    if(ctx.measureText(text).width<=maxWidth)break;
    s--;
  }
  let result=text;
  if(ctx.measureText(result).width>maxWidth){
    while(result.length>2 && ctx.measureText(result+'…').width>maxWidth)result=result.slice(0,-1);
    result+='…';
  }
  ctx.fillText(result,x,y);
}
function landscape(ctx) {
  const sky=ctx.createLinearGradient(0,0,0,300);
  sky.addColorStop(0,'#0a3928');sky.addColorStop(1,'#216b4c');
  ctx.fillStyle=sky;ctx.fillRect(0,0,WIDTH,314);
  ctx.fillStyle='#ffffff13';ctx.beginPath();ctx.arc(914,71,90,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#98bd8236';
  for(let j=0;j<3;j++){
    ctx.beginPath();ctx.moveTo(-20,220+j*32);
    ctx.bezierCurveTo(225,102+j*20,400,282+j*8,645,172+j*17);
    ctx.bezierCurveTo(840,108+j*24,955,220+j*12,1100,150+j*25);
    ctx.lineTo(1100,315);ctx.lineTo(0,315);ctx.fill();
  }
  ctx.strokeStyle='#a5c19d32';ctx.lineWidth=3;
  for(let i=0;i<15;i++){const x=i*81;ctx.beginPath();ctx.moveTo(x,295);ctx.lineTo(x+54,260);ctx.stroke();}
  ctx.fillStyle='#eebd54';ctx.fillRect(0,307,WIDTH,7);
}
function drawPoster(canvas,{date,state,level,lang,items,page,pages,mode}) {
  canvas.width=WIDTH;canvas.height=HEIGHT;
  const c=canvas.getContext('2d');
  c.fillStyle='#f7f5eb';c.fillRect(0,0,WIDTH,HEIGHT);
  landscape(c);
  c.textBaseline='alphabetic';
  c.textAlign='left';
  c.fillStyle='#ffffff';textFit(c,'SKY AGRO · 天順農業',48,66,850,43,32);
  c.fillStyle='#d8eacd';c.font='600 21px Arial, "Microsoft YaHei", sans-serif';
  c.fillText('PERTANIAN  ·  BAJA  ·  BENIH',51,99);
  c.fillStyle='#fff8dc';
  textFit(c,lang==='zh'?'蔬菜市场价格':'HARGA PASARAN SAYUR',50,160,960,57,39);
  c.fillStyle='#f6dc73';textFit(c,stateName(state,lang).toUpperCase(),50,229,965,49,36);
  roundRect(c,48,245,625,47,12,'#e9eedf');
  c.fillStyle='#194b35';textFit(c,LEVEL_LABELS[level][lang==='zh'?1:0]+'  |  RM',66,278,584,29,24);
  roundRect(c,742,250,290,46,12,'#ffffffec');
  c.fillStyle='#16412e';textFit(c,date.split('-').reverse().join('/'),757,281,270,28,24);
  c.fillStyle='#244d37';c.font='700 23px Arial, "Microsoft YaHei", sans-serif';
  c.fillText(lang==='zh'?'真实 FAMA 报价区间':'JULAT HARGA REKOD FAMA',48,367);
  c.fillStyle='#657b6b';c.font='20px Arial, "Microsoft YaHei", sans-serif';
  c.fillText(lang==='zh'?'同品种／等级／单位，按州内记录最低至最高价':'Minimum – maksimum mengikut negeri, gred & unit',48,399);
  const columns=2, rowsPerCol=9, cardWidth=484, startX=42, startY=423, rowHeight=77;
  if(!items.length) {
    roundRect(c,44,459,992,422,23,'#ffffff');
    c.textAlign='center';c.fillStyle='#476c55';
    c.font='700 38px Arial, "Microsoft YaHei", sans-serif';
    c.fillText(lang==='zh'?'本日没有对应报价':'Tiada rekod harga bagi pilihan ini',540,637);
    c.font='25px Arial, "Microsoft YaHei", sans-serif';
    c.fillText(lang==='zh'?'不使用旧日期或估算价格':'Tiada harga dianggarkan / tarikh lama',540,690);
    c.textAlign='left';
  }
  items.forEach((item,i)=>{
    const col=Math.floor(i/rowsPerCol),row=i%rowsPerCol;
    const x=startX+col*512,y=startY+row*rowHeight;
    roundRect(c,x,y,cardWidth,70,12,row%2?'#eef3e7':'#ffffff');
    roundRect(c,x+10,y+12,5,47,2,'#5c9470');
    c.textAlign='left';c.fillStyle='#163e2e';
    const title=lang==='zh'?translateProduct(item.varieti):item.varieti;
    textFit(c,title,x+27,y+30,435,25,17);
    c.fillStyle='#506d5a';c.font='18px Arial, "Microsoft YaHei", sans-serif';
    const grade=(item.gred && item.gred!=='F.A.Q') ? item.gred+' · ':'';
    c.fillText(grade+unitLabel(item.unit,lang),x+28,y+57);
    const price=money(item.min)+(item.min!==item.max?' – '+money(item.max):'');
    c.textAlign='right';c.fillStyle='#19583c';
    textFit(c,'RM '+price,x+455,y+58,275,25,20);
  });
  c.textAlign='left';
  roundRect(c,44,1143,992,166,18,'#113f2d');
  c.fillStyle='#fff';c.font='700 25px Arial, "Microsoft YaHei", sans-serif';
  c.fillText(lang==='zh'?'你当地的价格是多少？欢迎留言！':'Harga di kawasan anda macam mana? Komen di bawah!',68,1186);
  c.fillStyle='#cbded0';c.font='19px Arial, "Microsoft YaHei", sans-serif';
  c.fillText(lang==='zh'?'来源：FAMA AMI · 仅供参考，非本店售价':'Sumber: FAMA AMI · Rujukan sahaja, bukan harga kedai',68,1222);
  c.fillText(lang==='zh'?'不同地区、等级、日期和单位会影响报价':'Harga berbeza ikut lokasi, gred, tarikh & unit',68,1250);
  c.fillStyle='#f6d77a';c.font='700 19px Arial, "Microsoft YaHei", sans-serif';
  c.fillText('SKY AGRO · Batu Gajah Perdana, Perak',68,1280);
  c.textAlign='right';c.fillText(String(page+1)+' / '+String(pages),1014,1280);
  c.textAlign='left';
}
function auditCSV(groups,states,options) {
  const esc=value=>{
    let t=String(value??'');
    if(/^[=+@-]/.test(t))t="'"+t;
    return '"'+t.replaceAll('"','""')+'"';
  };
  const rows=[['Survey date','State','Price level','Variety (FAMA)','Grade','Unit','Min (RM)','Max (RM)','Observations','Distinct source markets']];
  for(const state of states)for(const item of pickProducts(groups,state,options.mode))
    rows.push([options.date,state,options.level,item.varieti,item.gred,item.unit,
      money(item.min),money(item.max),item.count,item.markets.size]);
  return new TextEncoder().encode('\uFEFF'+rows.map(r=>r.map(esc).join(',')).join('\r\n')+'\r\n');
}
function createCaption({date,state,level,lang,items}) {
  const loc=stateName(state,lang),dateDisplay=date.split('-').reverse().join('/');
  if(lang==='zh')return '🌱 SKY AGRO｜'+loc+'蔬菜价格\n📅 '+dateDisplay+' · '+LEVEL_LABELS[level][1]+
    '\n\n'+(items.length?'本图根据 FAMA 当日真实记录整理，显示各品种同等级及单位的最低—最高报价。':'当日此地区／价格层级没有符合条件的蔬菜报价。')+
    '\n\n你当地卖什么价？欢迎留言交流！\n\n数据来源：FAMA AMI。价格随地区、等级、日期、单位而不同，并非 SKY AGRO 店内售价。\n#SkyAgro #农业价格 #马来西亚农民';
  return '🌱 SKY AGRO | HARGA SAYUR '+loc.toUpperCase()+'\n📅 '+dateDisplay+' · '+LEVEL_LABELS[level][0]+
    '\n\n'+(items.length?'Julat harga minimum–maksimum daripada rekod FAMA sebenar mengikut produk, gred dan unit.':'Tiada rekod harga sayur bagi negeri dan peringkat terpilih pada tarikh ini.')+
    '\n\nKawasan korang harga macam mana? Jom komen! 👇\n\nSumber: FAMA AMI. Harga ikut lokasi, gred, tarikh & unit. Bukan harga jualan SKY AGRO.\n#SkyAgro #HargaSayur #HargaPasaran #PetaniMalaysia';
}
async function posterBytes(spec) {
  const canvas=document.createElement('canvas');
  drawPoster(canvas,spec);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(Error('PNG 生成失败')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
function saveBlob(blob,filename) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function u16(d,o,v){d.setUint16(o,v,true);}
function u32(d,o,v){d.setUint32(o,v>>>0,true);}
function crc32(bytes) {
  let crc=0xffffffff;
  for(const b of bytes){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function zip(files) {
  const encoder=new TextEncoder(),localParts=[],centralParts=[];
  let offset=0;
  for(const f of files){
    const name=encoder.encode(f.name),data=f.data,checksum=crc32(data);
    const head=new Uint8Array(30+name.length),h=new DataView(head.buffer);
    u32(h,0,0x04034b50);u16(h,4,20);u16(h,6,0x0800);u16(h,8,0);
    u32(h,14,checksum);u32(h,18,data.length);u32(h,22,data.length);
    u16(h,26,name.length);head.set(name,30);
    localParts.push(head,data);
    const entry=new Uint8Array(46+name.length),c=new DataView(entry.buffer);
    u32(c,0,0x02014b50);u16(c,4,20);u16(c,6,20);u16(c,8,0x0800);
    u32(c,16,checksum);u32(c,20,data.length);u32(c,24,data.length);
    u16(c,28,name.length);u32(c,42,offset);entry.set(name,46);
    centralParts.push(entry);offset+=head.length+data.length;
  }
  const centralSize=centralParts.reduce((n,p)=>n+p.length,0),tail=new Uint8Array(22),e=new DataView(tail.buffer);
  u32(e,0,0x06054b50);u16(e,8,files.length);u16(e,10,files.length);
  u32(e,12,centralSize);u32(e,16,offset);
  return new Blob([...localParts,...centralParts,tail],{type:'application/zip'});
}
async function dataForForm() {
  const v=values(); await getArchive();
  const rows=await getDate(v.date);
  const groups=buildGroups(rows,v.date,v.level);
  return {v,groups};
}
// Build only descriptors, not dozens of expensive canvases. Every page is rendered on demand.
function buildPreviewGallery(v,groups) {
  const states=v.state==='ALL'?STATES.map(s=>s[0]):[v.state];
  const languages=v.language==='both'?['bm','zh']:[v.language];
  const gallery=[];
  for(const state of states) {
    const allItems=pickProducts(groups,state,v.mode),pages=paginate(allItems);
    for(const lang of languages)for(let page=0;page<pages.length;page++)
      gallery.push({date:v.date,state,level:v.level,lang,items:pages[page],allItems,
        page,pages:pages.length,mode:v.mode});
  }
  return gallery;
}
function selectedSpec() {
  return previewData?.gallery?.[previewIndex]||null;
}
function galleryLabel(spec) {
  if(!spec)return '等待预览…';
  return stateName(spec.state,'zh')+' · '+(spec.lang==='bm'?'BM':'中文')+
    ' · 第 '+(spec.page+1)+' / '+spec.pages+' 页';
}
function updateGalleryControls() {
  const count=previewData?.gallery?.length||0,canUse=!busy&&count>0;
  $('fb-post-expand').disabled=!canUse;
  for(const id of ['fb-post-prev','fb-lightbox-prev'])$(id).disabled=!canUse||previewIndex<=0;
  for(const id of ['fb-post-next','fb-lightbox-next'])$(id).disabled=!canUse||previewIndex>=count-1;
}
function renderPreviewSelection() {
  const spec=selectedSpec();
  if(!spec)return;
  drawPoster($('fb-post-canvas'),spec);
  if($('fb-preview-dialog').open)drawPoster($('fb-lightbox-canvas'),spec);
  previewData.state=spec.state;
  previewData.items=spec.allItems;
  $('fb-post-page-label').textContent=(previewIndex+1)+' / '+previewData.gallery.length;
  $('fb-lightbox-count').textContent=(previewIndex+1)+' / '+previewData.gallery.length;
  $('fb-lightbox-subtitle').textContent=galleryLabel(spec);
  updateGalleryControls();
}
function changePreview(step) {
  if(busy||!previewData)return;
  const next=previewIndex+step;
  if(next<0||next>=previewData.gallery.length)return;
  previewIndex=next;
  renderPreviewSelection();
}
function openPreviewDialog() {
  if(busy||!selectedSpec())return;
  const dialog=$('fb-preview-dialog');
  if(!dialog.open)dialog.showModal();
  drawPoster($('fb-lightbox-canvas'),selectedSpec());
  $('fb-lightbox-close').focus();
}
async function preview() {
  if(busy)return;
  setBusy(true);
  try {
    setStatus('正在读取并验证所选日期 FAMA CSV…');
    const {v,groups}=await dataForForm();
    const gallery=buildPreviewGallery(v,groups);
    if(!gallery.length)throw Error('没有可预览的州属或语言');
    previewData={v,gallery,state:null,items:null};
    previewIndex=v.state==='ALL'?Math.max(0,gallery.findIndex(x=>x.state==='PERAK'&&x.lang===(v.language==='zh'?'zh':'bm'))):0;
    renderPreviewSelection();
    setStatus('已载入 '+gallery.length+' 张预览 · 当前 '+galleryLabel(selectedSpec())+
      '。点击图片放大，使用左右箭头切换地区、语言及分页；所有报价来自当天 CSV。');
  }catch(error){
    previewData=null;previewIndex=0;
    $('fb-post-page-label').textContent='预览不可用';
    $('fb-lightbox-count').textContent='0 / 0';
    if($('fb-preview-dialog').open)$('fb-preview-dialog').close();
    setStatus('预览失败：'+error.message,true);
  }
  finally{setBusy(false);}
}
async function generate(single) {
  if(busy)return;
  setBusy(true);
  try{
    setStatus('正在验证全部原始 CSV 报价…');
    const {v,groups}=await dataForForm();
    const states=single?[v.state==='ALL'?(previewData?.state||'PERAK'):v.state]:(v.state==='ALL'?STATES.map(s=>s[0]):[v.state]);
    const langs=v.language==='both'?['bm','zh']:[v.language];
    const files=[];
    for(let i=0;i<states.length;i++){
      const state=states[i],items=pickProducts(groups,state,v.mode),pages=paginate(items);
      for(const lang of langs)for(let page=0;page<pages.length;page++){
        const filename=state.replaceAll(/[^a-zA-Z0-9]+/g,'_')+'_'+lang.toUpperCase()+
          (pages.length>1?'_P'+(page+1):'')+'.png';
        files.push({name:filename,data:await posterBytes({date:v.date,state,level:v.level,lang,items:pages[page],page,pages:pages.length,mode:v.mode})});
      }
      setStatus('正在生成图片：'+(i+1)+' / '+states.length+' 地区，已完成 '+files.filter(f=>f.name.endsWith('.png')).length+' 张…');
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    files.push({name:'FAMA_PRICE_AUDIT_'+v.date+'.csv',data:auditCSV(groups,states,v)});
    if(single && files.filter(f=>f.name.endsWith('.png')).length===1){
      const picture=files.find(f=>f.name.endsWith('.png'));
      saveBlob(new Blob([picture.data],{type:'image/png'}),'SKY_AGRO_'+v.date+'_'+picture.name);
    }else{
      saveBlob(zip(files),'SKY_AGRO_FAMA_FB_'+v.date+'_'+v.level+'_'+v.language+'.zip');
    }
    setStatus('已生成 '+files.filter(f=>f.name.endsWith('.png')).length+' 张图片，包含 '+states.length+' 个地区；请检查浏览器下载。');
  }catch(error){setStatus('导出失败：'+error.message,true);}
  finally{setBusy(false);}
}
async function copyCaption() {
  if(busy)return;
  try{
    let d=previewData;
    if(!d || d.v.date!==values().date || d.v.level!==values().level || d.v.mode!==values().mode) {
      await preview();d=previewData;
    }
    if(!d)throw Error('请先生成有效预览');
    const languages=values().language==='both'?['bm','zh']:[values().language];
    const result=languages.map(lang=>createCaption({date:d.v.date,state:d.state,level:d.v.level,lang,items:d.items})).join('\n\n--------------------\n\n');
    await navigator.clipboard.writeText(result);
    setStatus('已复制'+(languages.length===2?'马来文及中文':languages[0]==='zh'?'中文':'马来文')+' Facebook 文案。');
  }catch(error){setStatus('复制失败：'+error.message,true);}
}
async function init() {
  const container=$('sky-fb-post-export');if(!container)return;
  const state=$('fb-post-state');
  for(const [key,bm,zh] of STATES)state.add(new Option(bm+' / '+zh,key));
  try{
    const m=await getArchive(), select=$('fb-post-date');
    for(const date of [...m.archive_dates].reverse())select.add(new Option(date,date));
    select.value=m.window?.max&&m.archive_dates.includes(m.window.max)?m.window.max:m.archive_dates.at(-1);
    for(const id of ['fb-post-date','fb-post-state','fb-post-level','fb-post-language','fb-post-mode'])
      $(id).addEventListener('change',()=>{previewData=null;previewIndex=0;preview();});
    $('fb-post-expand').addEventListener('click',openPreviewDialog);
    $('fb-post-prev').addEventListener('click',()=>changePreview(-1));
    $('fb-post-next').addEventListener('click',()=>changePreview(1));
    $('fb-lightbox-prev').addEventListener('click',()=>changePreview(-1));
    $('fb-lightbox-next').addEventListener('click',()=>changePreview(1));
    $('fb-lightbox-close').addEventListener('click',()=>$('fb-preview-dialog').close());
    $('fb-preview-dialog').addEventListener('click',event=>{
      if(event.target===$('fb-preview-dialog'))$('fb-preview-dialog').close();
    });
    document.addEventListener('keydown',event=>{
      if(!$('fb-preview-dialog').open)return;
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
        event.preventDefault();
        changePreview(event.key==='ArrowLeft'?-1:1);
      }
    });
    $('fb-post-preview').addEventListener('click',preview);
    $('fb-post-single').addEventListener('click',()=>generate(true));
    $('fb-post-zip').addEventListener('click',()=>generate(false));
    $('fb-post-copy').addEventListener('click',copyCaption);
    await preview();
  }catch(error){setStatus('初始化失败：'+error.message,true);}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
