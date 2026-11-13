/* FAMA mobile PDFs. All content is generated in-browser from the selected
 * official CSV rows; no server, dependency, fallback data, or price estimates.
 * Full report retains all source IDs, revisions and missing values.
 */
import {canonicalDailyRows,isValidISODate,sourcePriceNeedsReview,validPrice} from './v3.1/engine.mjs?rev=price-evidence-2';

const W=420,H=744,LEFT=26,RIGHT=394,CONTENT_END=636;
const C={ink:'#1B3430',green:'#143B30',accent:'#23654C',bg:'#F4F8F5',white:'#FFFFFF',
  pale:'#E8F2EB',muted:'#607570',border:'#DCE6E0',gold:'#B16E16',blue:'#2B63AA'};
const LEVELS=['Ladang','Borong','Runcit'];
const ORDER=['PERLIS','KEDAH','PULAU PINANG','PERAK','SELANGOR','NEGERI SEMBILAN',
  'MELAKA','JOHOR','PAHANG','TERENGGANU','KELANTAN','SABAH','SARAWAK',
  'W.P. KUALA LUMPUR','W.P. PUTRAJAYA','W.P. LABUAN'];

function plain(v){return String(v??'').replace(/[\u2012-\u2015]/g,'-')
  .replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u00a0/g,' ')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?');}
function literal(v){return '('+plain(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')+')';}
function rgb(hex){return [0,2,4].map(i=>(parseInt(hex.slice(1+i,3+i),16)/255).toFixed(3)).join(' ');}
function price(row){return validPrice(row.harga);}
function money(v){return Number.isFinite(v)?'RM '+v.toFixed(2):'-';}
function key(row,cols){return cols.map(c=>String(row[c]??'').trim()).join('\u001e');}
function productName(row){return [row.varieti,row.gred,row.unit].filter(Boolean).join(' / ')||'Komoditi tidak dinyatakan';}
function sortStates(values){return [...values].sort((a,b)=>{
  const ai=ORDER.indexOf(a),bi=ORDER.indexOf(b);
  return (ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b);
});}
function orderRows(rows){return [...rows].sort((a,b)=>String(b.tarikh_harga).localeCompare(String(a.tarikh_harga))||
  String(a.negeri).localeCompare(String(b.negeri))||String(a.daerah).localeCompare(String(b.daerah))||
  String(a.lokasi).localeCompare(String(b.lokasi))||String(a.varieti).localeCompare(String(b.varieti)));}
function period(from,to){return from===to?from:from+' hingga '+to;}
function wrapLines(text,maxWidth,size=10,bold=false){
  // Conservative Helvetica measurements prevent clipping in mobile readers.
  const max=Math.max(7,Math.floor(maxWidth/(size*(bold?.67:.59))));
  const all=plain(text).split(/\s+/).filter(Boolean),lines=[];let line='';
  for(const word of all){
    if((line+' '+word).trim().length>max&&line){lines.push(line);line='';}
    if(word.length>max){
      if(line){lines.push(line);line='';}
      for(let i=0;i<word.length;i+=max)lines.push(word.slice(i,i+max));
    }else line=(line+' '+word).trim();
  }
  if(line)lines.push(line);
  return lines.length?lines:['-'];
}
function priceRange(values){
  const valid=values.filter(v=>v!==null);
  if(!valid.length)return '-';
  const min=Math.min(...valid),max=Math.max(...valid);
  return min===max?min.toFixed(2):min.toFixed(2)+'-'+max.toFixed(2);
}
export function canonicalPdfRows(rows,superseded={}){
  const days=byKey(rows,['tarikh_harga']);
  const canonical=new Set([...days.values()].flatMap(daily=>
    canonicalDailyRows(daily,superseded[daily[0].tarikh_harga]||[])));
  return rows.filter(row=>canonical.has(row));
}
export function pdfPriceRanges(rows){
  const groups=new Map();
  for(const row of rows){
    const v=price(row),level=String(row.peringkat||'');
    if(v===null||!LEVELS.includes(level))continue;
    const id=key(row,['varieti','gred','unit','kategori']);
    const item=groups.get(id)||{varieti:row.varieti,gred:row.gred,unit:row.unit,
      kategori:row.kategori,levels:{},locations:new Set(),observations:0};
    const g=item.levels[level]||{min:v,max:v,count:0};
    g.min=Math.min(g.min,v);g.max=Math.max(g.max,v);g.count++;
    item.levels[level]=g;item.observations++;
    item.locations.add(key(row,['negeri','daerah','lokasi']));groups.set(id,item);
  }
  return [...groups.values()].sort((a,b)=>b.locations.size-a.locations.size||String(a.varieti).localeCompare(String(b.varieti)));
}

const methods={
  fill(x,y,w,h,color){this.code.push(rgb(color)+' rg '+x+' '+(H-y-h)+' '+w+' '+h+' re f');},
  line(x1,y1,x2,y2,color){this.code.push(rgb(color)+' RG 0.7 w '+x1+' '+(H-y1)+' m '+x2+' '+(H-y2)+' l S');},
  text(v,x,y,size=10,color=C.ink,bold=false){
    this.code.push('BT /'+(bold?'F2':'F1')+' '+size+' Tf '+rgb(color)+' rg 1 0 0 1 '+x+' '+(H-y-size)+' Tm '+literal(v)+' Tj ET');
  },
  wrap(v,x,y,width,size=10,color=C.ink,bold=false,step=size*1.45){
    const lines=wrapLines(v,width,size,bold);
    lines.forEach((s,i)=>this.text(s,x,y+i*step,size,color,bold));
    return y+lines.length*step;
  },
  link(x,y,w,h,id){this.links.push({x,y,w,h,id});}
};
class Pdf{
  constructor(){this.pages=[];this.anchors=new Map();this.outline=[];}
  page(title,{anchor,parent,subtitle='',section=''}={}){
    const p={title,code:[],links:[]};Object.assign(p,methods);
    this.pages.push(p);
    if(anchor){
      if(this.anchors.has(anchor))throw Error('Duplicate PDF destination: '+anchor);
      this.anchors.set(anchor,this.pages.length-1);
      if(title)this.outline.push({id:anchor,parent,title,page:this.pages.length-1});
    }
    p.fill(0,0,W,H,C.bg);p.fill(0,0,W,73,C.green);
    p.text('HARGA PASARAN PERTANIAN MALAYSIA',LEFT,19,12,C.white,true);
    p.text(subtitle||'FAMA AMI | Maklumat harga untuk rujukan',LEFT,47,8.5,'#D5E7DE');
    if(section)p.text(section.toUpperCase(),LEFT,88,8.7,C.accent,true);
    return p;
  }
  finish(){
    const objects=[null],reserve=()=>{objects.push('');return objects.length-1;},set=(i,s)=>{objects[i]=s;};
    const catalog=reserve(),pagesRoot=reserve(),font1=reserve(),font2=reserve();
    set(font1,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    set(font2,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pages=this.pages.map(()=>reserve());
    const links=this.pages.map(p=>p.links.map(()=>reserve()));
    const outlineRoot=this.outline.length?reserve():0;
    const outlines=new Map(this.outline.map(item=>[item.id,reserve()]));
    const children=new Map();
    for(const item of this.outline){
      const parent=outlines.has(item.parent)?item.parent:'root';
      if(!children.has(parent))children.set(parent,[]);
      children.get(parent).push(item);
    }
    for(let i=0;i<this.pages.length;i++){
      const p=this.pages[i];
      p.line(LEFT,710,RIGHT,710,C.border);
      p.text('Sumber: FAMA AMI | Harga rujukan, bukan tawaran jual beli',LEFT,723,7,C.muted);
      p.text('Luke Ng | '+(i+1)+'/'+this.pages.length,329,723,7,C.muted);
      const stream=p.code.join('\n')+'\n',content=reserve();
      set(content,'<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream');
      const refs=p.links.map((link,j)=>{
        const target=this.anchors.get(link.id);
        if(target===undefined)throw Error('Missing PDF link target '+link.id);
        const rect='['+link.x+' '+(H-link.y-link.h)+' '+(link.x+link.w)+' '+(H-link.y)+']';
        set(links[i][j],'<< /Type /Annot /Subtype /Link /Rect '+rect+
          ' /Border [0 0 0] /Dest ['+pages[target]+' 0 R /Fit] >>');
        return links[i][j];
      });
      set(pages[i],'<< /Type /Page /Parent '+pagesRoot+' 0 R /MediaBox [0 0 '+W+' '+H+
        '] /Resources << /Font << /F1 '+font1+' 0 R /F2 '+font2+' 0 R >> >> /Contents '+
        content+' 0 R /Annots ['+refs.map(n=>n+' 0 R').join(' ')+'] >>');
    }
    if(outlineRoot){
      for(const item of this.outline){
        const parent=outlines.has(item.parent)?item.parent:'root';
        const siblings=children.get(parent),i=siblings.indexOf(item),sub=children.get(item.id)||[];
        const parentRef=parent==='root'?outlineRoot:outlines.get(parent);
        set(outlines.get(item.id),'<< /Title '+literal(item.title)+' /Parent '+parentRef+
          ' 0 R /Dest ['+pages[item.page]+' 0 R /Fit]'+
          (i?' /Prev '+outlines.get(siblings[i-1].id)+' 0 R':'')+
          (i<siblings.length-1?' /Next '+outlines.get(siblings[i+1].id)+' 0 R':'')+
          (sub.length?' /First '+outlines.get(sub[0].id)+' 0 R /Last '+outlines.get(sub.at(-1).id)+
            ' 0 R /Count '+sub.length:'')+' >>');
      }
      const roots=children.get('root')||[];
      set(outlineRoot,'<< /Type /Outlines /First '+outlines.get(roots[0].id)+' 0 R /Last '+
        outlines.get(roots.at(-1).id)+' 0 R /Count '+this.outline.length+' >>');
    }
    set(pagesRoot,'<< /Type /Pages /Kids ['+pages.map(n=>n+' 0 R').join(' ')+'] /Count '+pages.length+' >>');
    set(catalog,'<< /Type /Catalog /Pages '+pagesRoot+' 0 R'+
      (outlineRoot?' /Outlines '+outlineRoot+' 0 R /PageMode /UseOutlines':'')+' >>');
    let out='%PDF-1.4\n%ASCII\n';const offsets=[];
    for(let i=1;i<objects.length;i++){offsets[i]=out.length;out+=i+' 0 obj\n'+objects[i]+'\nendobj\n';}
    const xref=out.length;out+='xref\n0 '+objects.length+'\n0000000000 65535 f \n';
    for(let i=1;i<objects.length;i++)out+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
    out+='trailer\n<< /Size '+objects.length+' /Root '+catalog+' 0 R >>\nstartxref\n'+xref+'\n%%EOF';
    return new TextEncoder().encode(out);
  }
}
function button(p,title,id,x,y=651,w=88){
  p.fill(x,y,w,36,C.white);p.line(x,y+36,x+w,y+36,C.border);
  p.text(title,x+11,y+12,9.0,C.green,true);
  if(id)p.link(x,y,w,36,id);
}
function bodyPage(doc,title,{anchor,parent,subtitle,section}={}){
  const p=doc.page(title,{anchor,parent,subtitle,section});
  return p;
}
function tierRange(rows,level,withCurrency=false){
  const tier=rows.filter(row=>row.peringkat===level);
  const range=priceRange(tier.map(price));
  const marker=tier.some(row=>sourcePriceNeedsReview(row))?' *':'';
  return (withCurrency&&range!=='-'?'RM ':'')+range+marker;
}
function byKey(rows,fields){const map=new Map();for(const r of rows){
  const id=key(r,fields);if(!map.has(id))map.set(id,[]);map.get(id).push(r);
}return map;}

function reportCover(doc,rows,{from,to,full}){
  const dates=[...new Set(rows.map(r=>r.tarikh_harga))].sort().reverse();
  const latest=dates[0],latestRows=rows.filter(r=>r.tarikh_harga===latest);
  const states=sortStates(new Set(latestRows.map(r=>r.negeri)));
  const p=bodyPage(doc,'Laporan Harga',{anchor:'home',subtitle:'Ladang  /  Borong  /  Runcit'});
  p.text('PANDUAN HARGA',LEFT,111,10,C.accent,true);
  p.wrap('Harga Pasaran Pertanian Malaysia',LEFT,148,360,23,C.green,true,31);
  p.text('Data terkini dalam laporan: '+latest,LEFT,242,10,C.muted);
  p.fill(LEFT,272,RIGHT-LEFT,72,C.white);
  for(const [x,number,caption] of [[39,dates.length,'TARIKH'],[158,rows.length.toLocaleString('en-MY'),'REKOD TEMPOH'],
    [282,states.length,'NEGERI TERKINI']]){
    p.text(number,x,292,18.5,C.green,true);
    p.text(caption,x,319,7.6,C.muted,true);
  }
  p.text('MULA DI SINI',LEFT,372,10.5,C.green,true);
  p.wrap('1. Lihat Quick View untuk ringkasan harga mengikut negeri.',LEFT,397,355,10,C.ink,false,17);
  p.wrap('2. Untuk harga tepat di lokasi tertentu, buka Laporan Penuh.',LEFT,448,355,10,C.ink,false,17);
  p.wrap('3. Pilih tarikh, negeri, daerah dan lokasi. Tekan kotak untuk melompat.',LEFT,499,355,10,C.ink,false,17);
  p.fill(LEFT,551,RIGHT-LEFT,78,C.pale);
  p.text('PERINGATAN',LEFT+13,569,9.6,C.green,true);
  p.wrap('(-) Tiada harga. (*) Semak harga dan unit; ada rekod sekurang-kurangnya 10 kali purata rujukan FAMA 14 hari.',
    LEFT+13,591,336,8.9,C.ink,false,14);
  if(full){
    button(p,'QUICK VIEW','guide',LEFT,648,164);
    button(p,'LAPORAN PENUH','date:'+latest,213,648,181);
  }else button(p,'BUKA QUICK VIEW','guide',LEFT,648,187);
  return {dates,latest,latestRows,states};
}

function guide(doc,rows,ctx,{full}){
  const p=bodyPage(doc,'Panduan Harga',{anchor:'guide',parent:'home',
    subtitle:'Quick View | '+ctx.latest,section:'QUICK VIEW'});
  p.text('Ringkasan Negeri',LEFT,118,18,C.green,true);
  p.text('LIPUTAN DATA MENGIKUT TARIKH',LEFT,158,10,C.green,true);
  let y=183;
  for(const date of ctx.dates.slice(0,3)){
    const stateCount=new Set(rows.filter(r=>r.tarikh_harga===date).map(r=>r.negeri)).size;
    p.fill(LEFT,y,RIGHT-LEFT,37,C.white);
    p.text(date+'  |  '+stateCount+' negeri/wilayah direkodkan',LEFT+12,y+11,9.8,C.green,true);
    if(full)p.link(LEFT,y,RIGHT-LEFT,37,'date:'+date);
    y+=43;
  }
  if(ctx.dates.length>3)p.text('+ '+(ctx.dates.length-3)+' tarikh terdahulu dalam laporan penuh',LEFT,y,8.5,C.muted);
  const guideY=Math.max(354,y+13);
  p.text('PETUNJUK HARGA',LEFT,guideY,10,C.green,true);
  const legend=[['L  LADANG','Harga di peringkat ladang',C.accent],
    ['B  BORONG','Harga di peringkat pemborong',C.gold],
    ['R  RUNCIT','Harga di peringkat peruncit',C.blue]];
  for(let i=0;i<legend.length;i++){
    const ty=guideY+30+i*43;
    p.fill(LEFT,ty,RIGHT-LEFT,37,C.white);
    p.text(legend[i][0],LEFT+12,ty+12,10,legend[i][2],true);
    p.text(legend[i][1],LEFT+135,ty+13,8.3,C.muted);
  }
  const footY=guideY+171;
  p.wrap('RM ialah Ringgit Malaysia. Unit seperti Kilogram dan Biji ditulis pada setiap komoditi.',
    LEFT,footY,360,9.1,C.muted,false,15);
  p.wrap('Quick View menunjukkan julat harga terendah hingga tertinggi daripada lokasi tersedia di negeri berkenaan, bukan satu harga rasmi seragam seluruh negeri.',
    LEFT,footY+53,360,9.0,C.muted,false,15);
  button(p,'UTAMA','home',LEFT);
  button(p,'HARGA NEGERI','quick-samples',LEFT+98,651,150);
}

function quickItems(rows){
  const products=byKey(rows,['varieti','gred','unit','kategori']);
  return [...products.values()].map(group=>({
    name:productName(group[0]),group,
    markets:new Set(group.map(r=>key(r,['negeri','daerah','lokasi']))).size
  })).sort((a,b)=>b.markets-a.markets||a.name.localeCompare(b.name)).slice(0,3);
}
function quickStatePages(doc,rows,canonical,ctx,{full}){
  const current=canonical.filter(r=>r.tarikh_harga===ctx.latest);
  const raw=rows.filter(r=>r.tarikh_harga===ctx.latest);
  let p=null,y=CONTENT_END;
  const quickPages=[];
  for(const state of ctx.states){
    const active=current.filter(r=>r.negeri===state),rawState=raw.filter(r=>r.negeri===state);
    const items=quickItems(active);
    const locations=new Set(rawState.map(r=>key(r,['negeri','daerah','lokasi']))).size;
    const heights=items.map(x=>wrapLines(x.name,337,8.8,true).length*11+22);
    const height=46+heights.reduce((a,b)=>a+b,0);
    if(!p||y+height+11>CONTENT_END){
      const isFirst=!p;
      const index=quickPages.length;
      const anchor=isFirst?'quick-samples':'quick-samples:page:'+index;
      p=bodyPage(doc,isFirst?'Harga Pilihan Mengikut Negeri':null,
        {anchor,parent:'guide',
          subtitle:'Quick View | '+ctx.latest,section:'SAMPEL KOMODITI DARIPADA REKOD TERSEDIA'});
      p.text('Harga Pilihan Mengikut Negeri',LEFT,118,17.5,C.green,true);
      y=151;
      quickPages.push(p);
    }
    p.fill(LEFT,y,RIGHT-LEFT,height,C.white);
    p.text(state,LEFT+12,y+12,10.3,C.green,true);
    p.text(locations+' lokasi | '+rawState.length+' rekod',LEFT+12,y+28,8,C.muted);
    let cy=y+42;
    for(const item of items){
      cy=p.wrap(item.name,LEFT+12,cy,337,8.8,C.ink,true,11);
      p.text(LEVELS.map(l=>l[0]+' '+tierRange(item.group,l)).join('      '),
        LEFT+12,cy+1,8.2,C.muted);
      cy+=22;
    }
    if(full)p.link(LEFT,y,RIGHT-LEFT,37,'state:'+ctx.latest+':'+state);
    y+=height+11;
  }
  for(let i=0;i<quickPages.length;i++){
    const page=quickPages[i];
    button(page,'UTAMA','home',LEFT);
    button(page,'PANDUAN','guide',LEFT+98);
    if(i<quickPages.length-1)button(page,'SETERUSNYA','quick-samples:page:'+(i+1),286,651,108);
    else if(i>0)button(page,'SEBELUM',i===1?'quick-samples':'quick-samples:page:'+(i-1),286,651,108);
  }
}
function quickAndCover(doc,records,canonical,opts){
  const ctx=reportCover(doc,records,opts);
  guide(doc,records,ctx,opts);
  quickStatePages(doc,records,canonical,ctx,opts);
  return ctx;
}

function directory(doc,{title,anchor,parent,date,section,items,back=[]}){
  const pages=[],chunks=[];let chunk=[],height=0;
  for(const item of items){
    const h=Math.max(38,18+15*wrapLines(item.text,306,10.2,true).length);
    if(chunk.length&&height+h>455){chunks.push(chunk);chunk=[];height=0;}
    chunk.push({...item,height:h});height+=h;
  }
  if(chunk.length||!chunks.length)chunks.push(chunk);
  for(let pi=0;pi<chunks.length;pi++){
    const id=pi?anchor+':page:'+pi:anchor;
    const p=bodyPage(doc,pi?null:title,{anchor:id,parent:pi?undefined:parent,
      subtitle:date,section});
    p.wrap(title+(pi?' (sambungan)':''),LEFT,116,368,18,C.green,true,23);
    let y=171;
    for(const item of chunks[pi]){
      p.fill(LEFT,y,RIGHT-LEFT,item.height-5,C.white);
      const actual=items.findIndex(v=>v.anchor===item.anchor)+1;
      p.text(String(actual).padStart(2,'0'),LEFT+10,y+12,9,C.muted,true);
      p.wrap(item.text,LEFT+43,y+10,306,10.2,C.green,true,15);
      p.link(LEFT,y,RIGHT-LEFT,item.height-5,item.anchor);
      y+=item.height;
    }
    let x=LEFT;
    for(const pair of [['UTAMA','home'],...back]){
      button(p,pair[0],pair[1],x);x+=98;
    }
    if(pi<chunks.length-1)button(p,'SETERUSNYA',anchor+':page:'+(pi+1),286,651,108);
    else if(pi>0)button(p,'SEBELUM',pi===1?anchor:anchor+':page:'+(pi-1),286,651,108);
    pages.push(p);
  }
  return pages;
}
function locationPage(doc,{date,state,district,location,anchor,parent,stateId,districtId}){
  const p=bodyPage(doc,null,{anchor,parent,subtitle:date,section:state+' / '+district});
  const end=p.wrap(location||'LOKASI TIDAK DINYATAKAN',LEFT,116,365,14.3,C.green,true,20);
  const buttons=[['UTAMA','home'],['TARIKH','date:'+date],['NEGERI',stateId],['DAERAH',districtId]];
  buttons.forEach((x,i)=>button(p,x[0],x[1],LEFT+i*91,651,82));
  return {page:p,y:end+15};
}
function renderLocation(doc,{date,state,district,location,rows,canonical,anchor,stateId,districtId}){
  const args={date,state,district,location,anchor,parent:districtId,stateId,districtId};
  const first=locationPage(doc,args);
  let p=first.page,y=first.y;
  p.text(rows.length+' rekod sumber | Pindaan ditanda, harga kosong dikekalkan',LEFT,y,8.4,C.muted);
  y+=29;
  const canonicalSet=new Set(canonical);
  const grouped=byKey(rows,['varieti','gred','unit','kategori']);
  for(const group of grouped.values()){
    const valid=group.filter(r=>canonicalSet.has(r));
    const heading=productName(group[0]),headingLines=wrapLines(heading,342,10,true);
    let offset=0;
    while(offset<group.length){
      const titleHeight=headingLines.length*15;
      const fixed=16+titleHeight+16+45+22;
      let available=CONTENT_END-y;
      if(available<fixed+27){
        const next=locationPage(doc,{...args,anchor:undefined});p=next.page;y=next.y+11;
        p.text('REKOD PASARAN (SAMBUNGAN)',LEFT,y,9,C.muted,true);
        y+=30;available=CONTENT_END-y;
      }
      const count=Math.min(group.length-offset,Math.max(1,Math.floor((available-fixed-15)/13)));
      const h=fixed+count*13;
      p.fill(LEFT,y,RIGHT-LEFT,h,C.white);
      let cy=p.wrap(heading,LEFT+12,y+14,342,10,C.ink,true,15);
      p.text(group[0].kategori||'Kategori tidak dinyatakan',LEFT+12,cy+1,8.4,C.muted);
      cy+=22;
      LEVELS.forEach((level,i)=>{
        const x=LEFT+12+i*121;
        p.text(level.toUpperCase(),x,cy,8.1,[C.accent,C.gold,C.blue][i],true);
        p.text(tierRange(valid,level,true),x,cy+18,9.4,C.ink,true);
      });
      cy+=43;
      p.text('Rekod asal ('+group.length+')'+(offset?' - sambungan':''),LEFT+12,cy,8.1,C.muted,true);
      cy+=15;
      for(const r of group.slice(offset,offset+count)){
        p.text(r.peringkat+' '+money(price(r))+(sourcePriceNeedsReview(r)?' *':'')+' | ID '+(r.priceid||'-')+
          (canonicalSet.has(r)?'':' [PINDAAN]'),LEFT+12,cy,8,C.muted);
        cy+=13;
      }
      y+=h+10;offset+=count;
    }
  }
}
function fullReport(rows,{from,to,canonical}){
  if(rows.length>6500)throw Error('Full Mobile PDF terhad kepada 6,500 rekod sumber. Pilih tarikh atau negeri yang lebih singkat; Quick View menyokong tempoh lebih panjang.');
  const doc=new Pdf();
  const ctx=quickAndCover(doc,rows,canonical,{from,to,full:true});
  for(const date of ctx.dates){
    const dateRows=rows.filter(r=>r.tarikh_harga===date);
    const states=sortStates(new Set(dateRows.map(r=>r.negeri)));
    const dateId='date:'+date;
    directory(doc,{title:'Pilih Negeri / Wilayah',anchor:dateId,parent:'home',
      date,section:'LAPORAN PENUH - TARIKH',back:[['QUICK VIEW','guide']],
      items:states.map(state=>({text:state,anchor:'state:'+date+':'+state}))});
    for(const state of states){
      const stateId='state:'+date+':'+state,stRows=dateRows.filter(r=>r.negeri===state);
      const districts=[...new Set(stRows.map(r=>r.daerah))].sort();
      directory(doc,{title:state,anchor:stateId,parent:dateId,
        date,section:'PILIH DAERAH',back:[['TARIKH',dateId]],
        items:districts.map(d=>({text:d||'DAERAH TIDAK DINYATAKAN',
          anchor:'district:'+date+':'+state+':'+d}))});
      for(const district of districts){
        const districtId='district:'+date+':'+state+':'+district;
        const districtRows=stRows.filter(r=>r.daerah===district);
        const locations=[...new Set(districtRows.map(r=>r.lokasi))].sort();
        directory(doc,{title:district||'DAERAH TIDAK DINYATAKAN',anchor:districtId,parent:stateId,
          date:state+' | '+date,section:'PILIH LOKASI',back:[['NEGERI',stateId]],
          items:locations.map(l=>({text:l||'LOKASI TIDAK DINYATAKAN',
            anchor:'loc:'+date+':'+state+':'+district+':'+l}))});
        for(const location of locations){
          const locRows=districtRows.filter(r=>r.lokasi===location);
          const valid=canonical.filter(r=>r.tarikh_harga===date&&r.negeri===state&&
            r.daerah===district&&r.lokasi===location);
          renderLocation(doc,{date,state,district,location,rows:locRows,canonical:valid,
            anchor:'loc:'+date+':'+state+':'+district+':'+location,stateId,districtId});
        }
      }
    }
  }
  return doc.finish();
}
function quickReport(rows,{from,to,canonical}){
  const doc=new Pdf();quickAndCover(doc,rows,canonical,{from,to,full:false});return doc.finish();
}
export function buildFamaPdf(records,{from,to,state='',level='',type='quick',superseded={}}={}){
  if(!isValidISODate(from)||!isValidISODate(to)||from>to)
    throw Error('Invalid PDF date range');
  if(!Array.isArray(records)||!records.length)throw Error('No FAMA records for PDF');
  if(records.some(r=>!isValidISODate(r.tarikh_harga)||r.tarikh_harga<from||r.tarikh_harga>to))
    throw Error('PDF date mismatch');
  const inScope=row=>(!state||row.negeri===state)&&(!level||row.peringkat===level);
  const rows=orderRows(records.filter(inScope));
  if(!rows.length)throw Error('No FAMA records for PDF');
  const canonical=canonicalPdfRows(records,superseded).filter(inScope);
  if(type==='quick')return quickReport(rows,{from,to,state,level,canonical});
  if(type==='full')return fullReport(rows,{from,to,state,level,canonical});
  throw Error('Unknown PDF report type');
}
export function downloadPdf(bytes,filename){
  const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
