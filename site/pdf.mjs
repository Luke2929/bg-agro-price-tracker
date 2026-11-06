/* Self-contained, offline PDF writer. FAMA CSV is the only price source.
 * A4-style landscape shortcuts and estimated prices are intentionally absent.
 * The 396 x 704 pt pages follow the mobile report specification.
 */

const WIDTH=396,HEIGHT=704;
const PALETTE={ink:'#203248',navy:'#173753',green:'#235B43',mint:'#ECF4EF',cream:'#FCFDF9',
  gold:'#AA7522',blue:'#326D96',muted:'#677889',line:'#DDE5E8',white:'#FFFFFF',light:'#F3F6F8'};
const LEVELS=['Ladang','Borong','Runcit'];
const STATE_ORDER=['PERLIS','KEDAH','PULAU PINANG','PERAK','SELANGOR','NEGERI SEMBILAN',
  'MELAKA','JOHOR','PAHANG','TERENGGANU','KELANTAN','SABAH','SARAWAK',
  'W.P. KUALA LUMPUR','W.P. PUTRAJAYA','W.P. LABUAN'];

function pdfText(value){
  // The report is Bahasa Melayu. Core PDF fonts use WinAnsi; normalize unusual
  // source characters without dropping the original FAMA values from the archive.
  return String(value??'').replace(/[\u2012-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201c\u201d]/g,'"').replace(/\u00a0/g,' ').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'?');
}
function quote(s){return '('+pdfText(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')+')';}
function rgb(hex){const v=hex.replace('#','');return [0,2,4].map(i=>(parseInt(v.slice(i,i+2),16)/255).toFixed(3)).join(' ');}
function dateLabel(date){return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:'Tarikh tidak diketahui';}
function money(number){return Number.isFinite(number)?'RM '+number.toFixed(2):'-';}
function price(row){const v=String(row.harga??'').trim();if(!v)return null;const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;}
function key(row,fields){return fields.map(f=>String(row[f]??'').trim()).join('\u001e');}
function label(row){return [row.varieti,row.gred,row.unit].filter(Boolean).join(' / ');}
function sortedStates(states){return [...states].sort((a,b)=>STATE_ORDER.indexOf(a)-STATE_ORDER.indexOf(b)||a.localeCompare(b));}
function orderRows(rows){return [...rows].sort((a,b)=>a.tarikh_harga.localeCompare(b.tarikh_harga)||
  a.negeri.localeCompare(b.negeri)||a.daerah.localeCompare(b.daerah)||
  a.lokasi.localeCompare(b.lokasi)||a.varieti.localeCompare(b.varieti));}

// Revision-aware, latest-in-file canonical rows, independently per date.
export function canonicalPdfRows(rows,superseded={}){
  const last=new Map();
  rows.forEach((row,index)=>{if(String(row.priceid||'').trim())last.set(key(row,['tarikh_harga','priceid']),index);});
  return rows.filter((r,i)=>!new Set(superseded[r.tarikh_harga]||[]).has(String(r.priceid||''))&&
    (!String(r.priceid||'').trim()||last.get(key(r,['tarikh_harga','priceid']))===i));
}

export function pdfPriceRanges(rows){
  const groups=new Map();
  for(const row of rows){
    const p=price(row),level=String(row.peringkat||'');
    if(p===null||!LEVELS.includes(level))continue;
    const id=key(row,['varieti','gred','unit','kategori']);
    const g=groups.get(id)||{varieti:row.varieti,gred:row.gred,unit:row.unit,
      kategori:row.kategori,levels:{},locations:new Set(),observations:0};
    const range=g.levels[level]||{min:p,max:p,count:0};
    range.min=Math.min(range.min,p);range.max=Math.max(range.max,p);range.count++;
    g.levels[level]=range;g.observations++;
    g.locations.add(key(row,['negeri','daerah','lokasi']));groups.set(id,g);
  }
  return [...groups.values()].sort((a,b)=>b.locations.size-a.locations.size||a.varieti.localeCompare(b.varieti));
}
function rangeLabel(range){return !range?'-':range.min===range.max?money(range.min):money(range.min)+' - '+money(range.max);}
function titleLines(text,maxWidth,font=12){
  const words=pdfText(text).split(/\s+/),lines=[];let current='';
  // Helvetica uppercase glyphs are wider than the average lowercase glyph.
  // Conservative wrapping avoids any clipped text at the mobile page edge.
  const max=Math.max(9,Math.floor(maxWidth/(font*.68)));
  for(const word of words){
    if((current+' '+word).trim().length>max&&current){lines.push(current);current='';}
    if(word.length>max){if(current)lines.push(current);for(let i=0;i<word.length;i+=max)lines.push(word.slice(i,i+max));current='';}
    else current=(current+' '+word).trim();
  }
  if(current)lines.push(current);return lines.length?lines:['-'];
}

class MobilePdf{
  constructor(){this.pages=[];this.outline=[];this.ids=new Map();}
  page(title,{anchor,parent}={}){
    const p={title,code:[],links:[],anchor};Object.assign(p,pdfPageMethods);this.pages.push(p);
    if(anchor){if(this.ids.has(anchor))throw Error('Duplicate PDF navigation destination');this.ids.set(anchor,this.pages.length-1);}
    if(anchor&&title)this.outline.push({id:anchor,parent,title,page:this.pages.length-1});
    p.fill(0,0,WIDTH,HEIGHT,PALETTE.cream);
    return p;
  }
  decorate(p,{date='',breadcrumbs='',root='cover',state='',district=''}={}){
    p.fill(0,0,WIDTH,59,PALETTE.navy);
    p.text('HARGA PASARAN PERTANIAN MALAYSIA',22,19,11,PALETTE.white,true);
    p.text(date?dateLabel(date):'DATA FAMA AMI',22,38,8,'#C9D9E4');
    let x=22;
    for(const [text,id] of [['UTAMA',root],['NEGERI',state],['DAERAH',district]]){
      if(!id)continue;
      p.fill(x,66,72,24,PALETTE.light);p.text(text,x+8,72,9,PALETTE.navy,true);
      p.link(x,66,72,24,id);x+=78;
    }
    if(breadcrumbs)p.text(breadcrumbs,22,101,8,PALETTE.muted);
  }
  finish(){
    const ref=[];const objects=[null];
    const reserve=()=>{objects.push('');return objects.length-1;};
    const set=(n,content)=>{objects[n]=content;};
    const catalog=reserve(),pagesRoot=reserve();
    const regular=reserve(),bold=reserve();
    set(regular,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    set(bold,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageRefs=this.pages.map(()=>reserve());
    const annotations=this.pages.map(p=>p.links.map(()=>reserve()));
    const outlinesRoot=this.outline.length?reserve():0;
    const outlineRefs=new Map(this.outline.map(item=>[item.id,reserve()]));
    const outlineChildren=new Map();
    for(const item of this.outline){
      const parent=outlineRefs.has(item.parent)?item.parent:'__root';
      if(!outlineChildren.has(parent))outlineChildren.set(parent,[]);
      outlineChildren.get(parent).push(item);
    }
    for(const [i,p] of this.pages.entries()){
      p.fill(0,674,WIDTH,30,PALETTE.cream);
      p.line(20,673,WIDTH-20,673,PALETTE.line);
      p.text('Sumber: FAMA AMI | Maklumat rujukan, bukan tawaran jual beli',22,684,7.5,PALETTE.muted);
      p.text(`${i+1} / ${this.pages.length}`,344,684,8,PALETTE.muted);
      const contents=reserve(),stream=p.code.join('\n')+'\n';
      set(contents,`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
      const annots=p.links.map((link,j)=>{
        const target=this.ids.get(link.id);
        if(target===undefined)return null;
        const rect=`[${link.x} ${HEIGHT-link.y-link.h} ${link.x+link.w} ${HEIGHT-link.y}]`;
        set(annotations[i][j],`<< /Type /Annot /Subtype /Link /Rect ${rect} /Border [0 0 0] /Dest [${pageRefs[target]} 0 R /Fit] >>`);
        return annotations[i][j];
      }).filter(Boolean);
      set(pageRefs[i],`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contents} 0 R /Annots [${annots.map(n=>n+' 0 R').join(' ')}] >>`);
    }
    if(outlinesRoot){
      for(const item of this.outline){
        const parent=outlineRefs.has(item.parent)?item.parent:'__root';
        const siblings=outlineChildren.get(parent),index=siblings.indexOf(item);
        const children=outlineChildren.get(item.id)||[];
        const parentRef=parent==='__root'?outlinesRoot:outlineRefs.get(parent);
        set(outlineRefs.get(item.id),`<< /Title ${quote(item.title)} /Parent ${parentRef} 0 R /Dest [${pageRefs[item.page]} 0 R /Fit]`
          +(index?` /Prev ${outlineRefs.get(siblings[index-1].id)} 0 R`:'')
          +(index<siblings.length-1?` /Next ${outlineRefs.get(siblings[index+1].id)} 0 R`:'')
          +(children.length?` /First ${outlineRefs.get(children[0].id)} 0 R /Last ${outlineRefs.get(children.at(-1).id)} 0 R /Count ${children.length}`:'')+' >>');
      }
      const roots=outlineChildren.get('__root')||[];
      set(outlinesRoot,`<< /Type /Outlines /First ${outlineRefs.get(roots[0].id)} 0 R /Last ${outlineRefs.get(roots.at(-1).id)} 0 R /Count ${this.outline.length} >>`);
    }
    set(pagesRoot,`<< /Type /Pages /Kids [${pageRefs.map(n=>n+' 0 R').join(' ')}] /Count ${pageRefs.length} >>`);
    set(catalog,`<< /Type /Catalog /Pages ${pagesRoot} 0 R`+(outlinesRoot?` /Outlines ${outlinesRoot} 0 R /PageMode /UseOutlines`:'')+' >>');
    let result='%PDF-1.4\n%ASCII\n';
    for(let i=1;i<objects.length;i++){
      ref[i]=result.length;result+=`${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const offset=result.length;
    result+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for(let i=1;i<objects.length;i++)result+=String(ref[i]).padStart(10,'0')+' 00000 n \n';
    result+=`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF`;
    return new TextEncoder().encode(result);
  }
}
const pdfPageMethods={
  fill(x,y,w,h,color){this.code.push(`${rgb(color)} rg ${x} ${HEIGHT-y-h} ${w} ${h} re f`);},
  line(x1,y1,x2,y2,color){this.code.push(`${rgb(color)} RG 0.7 w ${x1} ${HEIGHT-y1} m ${x2} ${HEIGHT-y2} l S`);},
  text(value,x,y,font=10,color=PALETTE.ink,bold=false){
    this.code.push(`BT /${bold?'F2':'F1'} ${font} Tf ${rgb(color)} rg 1 0 0 1 ${x} ${HEIGHT-y-font} Tm ${quote(value)} Tj ET`);
  },
  wrap(value,x,y,width,font=10,color=PALETTE.ink,bold=false,lineHeight=font*1.45){
    for(const [index,line] of titleLines(value,width,font).entries())this.text(line,x,y+index*lineHeight,font,color,bold);
    return y+titleLines(value,width,font).length*lineHeight;
  },
  link(x,y,w,h,id){this.links.push({x,y,w,h,id});}
};
// Page prototypes are attached before rendering; no external PDF dependency.
function newPage(doc,title,options){const p=doc.page(title,options);Object.assign(p,pdfPageMethods);return p;}

function counter(p,x,y,n,title){p.text(n,x,y,19,PALETTE.navy,true);p.text(title,x,y+29,8,PALETTE.muted,true);}
function simpleRows(p,rows,startY=125,{font=10,step=23,link=true}={}){
  let y=startY;
  rows.forEach((item,i)=>{
    if(i%2===0)p.fill(20,y-3,WIDTH-40,step,PALETTE.light);
    p.text(String(i+1).padStart(2,'0'),27,y,font,PALETTE.muted);
    p.text(item.text,55,y,font,PALETTE.navy,true);
    if(item.meta)p.text(item.meta,305,y,8,PALETTE.muted);
    if(link&&item.anchor)p.link(21,y-4,WIDTH-43,step,item.anchor);
    y+=step;
  });
}
function periodText(from,to){return from===to?from:`${from} hingga ${to}`;}

function quickReport(rows,{from,to,state,level,canonical}){
  const doc=new MobilePdf(),active=canonical,ranges=pdfPriceRanges(active);
  const states=sortedStates(new Set(active.map(r=>r.negeri))),locations=new Set(active.map(r=>key(r,['negeri','daerah','lokasi']))),
    districts=new Set(active.map(r=>key(r,['negeri','daerah'])));
  const cover=newPage(doc,'Quick View',{anchor:'cover'});doc.decorate(cover,{date:periodText(from,to),root:'cover'});
  cover.text('QUICK VIEW',23,130,12,PALETTE.green,true);
  cover.wrap('HARGA PASARAN PERTANIAN MALAYSIA',22,166,345,26,PALETTE.navy,true,33);
  cover.text('RINGKASAN HARGA / TEMPOH PILIHAN',22,258,10,PALETTE.muted);
  cover.text(periodText(from,to),22,280,13,PALETTE.navy,true);
  cover.line(22,318,374,318,PALETTE.line);
  counter(cover,25,334,String(states.length),'NEGERI / W.P.');
  counter(cover,111,334,String(districts.size),'DAERAH');
  counter(cover,198,334,String(locations.size),'LOKASI');
  counter(cover,285,334,rows.length.toLocaleString('en-MY'),'REKOD SUMBER');
  cover.text('KANDUNGAN',22,420,11,PALETTE.green,true);
  simpleRows(cover,[{text:'Liputan negeri',anchor:'coverage'},
    {text:'Sayur-sayuran - harga ringkas',anchor:'vegetables'},
    {text:'Kategori lain dan nota',anchor:'other'}],442,{step:31,font:10});
  cover.wrap(`Penapis: ${state||'Seluruh Malaysia'} / ${level||'Semua peringkat'}. Harga ialah julat rekod sebenar dalam tempoh dipilih.`,24,576,340,9,PALETTE.muted);

  const coverage=newPage(doc,'Liputan Negeri',{anchor:'coverage'});doc.decorate(coverage,{date:periodText(from,to),root:'cover'});
  coverage.text('LIPUTAN MENGIKUT NEGERI',22,126,17,PALETTE.navy,true);
  coverage.text('Bilangan daerah, lokasi dan rekod bagi tempoh dipilih.',22,154,9,PALETTE.muted);
  const stateRows=states.map(name=>({name,subset:active.filter(r=>r.negeri===name)}));
  stateRows.forEach((s,i)=>{
    const x=i<8?22:201,y=192+(i%8)*56,sub=s.subset;
    coverage.fill(x,y,171,48,i%2?PALETTE.light:PALETTE.mint);
    coverage.wrap(s.name,x+9,y+6,149,9,PALETTE.navy,true,10);
    coverage.text(`${new Set(sub.map(r=>r.daerah)).size} daerah / ${new Set(sub.map(r=>r.lokasi)).size} lokasi / ${sub.length} rekod`,x+9,y+31,7.5,PALETTE.muted);
  });
  const vegetable=newPage(doc,'Sayur-Sayuran',{anchor:'vegetables'});doc.decorate(vegetable,{date:periodText(from,to),root:'cover'});
  vegetable.text('SAYUR-SAYURAN',22,128,19,PALETTE.navy,true);
  vegetable.text('5 varieti paling banyak lokasi yang mempunyai harga sah',22,158,9,PALETTE.muted);
  const topVeg=ranges.filter(r=>/sayur/i.test(r.kategori)).slice(0,5);
  topVeg.forEach((item,i)=>{
    const y=190+i*86;vegetable.fill(21,y,354,78,i%2?PALETTE.light:PALETTE.mint);
    vegetable.wrap(label(item),31,y+8,334,10,PALETTE.navy,true,12);
    vegetable.text(`${item.locations.size} lokasi`,31,y+31,8,PALETTE.muted);
    LEVELS.forEach((level,j)=>{
      vegetable.text(level.toUpperCase(),32+j*116,y+49,7,[PALETTE.green,PALETTE.gold,PALETTE.blue][j],true);
      vegetable.text(rangeLabel(item.levels[level]),32+j*116,y+61,8,PALETTE.ink,true);
    });
  });
  if(!topVeg.length)vegetable.text('Tiada rekod sayur-sayuran untuk penapis ini.',22,205,10,PALETTE.muted);

  const other=newPage(doc,'Kategori Lain dan Nota',{anchor:'other'});doc.decorate(other,{date:periodText(from,to),root:'cover'});
  other.text('KATEGORI LAIN',22,128,18,PALETTE.navy,true);
  const cats=[['Buah-Buahan','Buah-buahan'],['Ternakan','Ternakan'],['Tanaman Kontan','Tanaman kontan'],
    ['Makanan Diproses','Makanan diproses'],['Hasil Laut','Hasil laut & perikanan']];
  cats.forEach(([hint,title],i)=>{
    const r=ranges.find(x=>x.kategori.toLowerCase().includes(hint.toLowerCase()))||null;
    const y=161+i*71;other.fill(22,y,352,65,i%2?PALETTE.light:PALETTE.mint);
    other.text(title.toUpperCase(),31,y+7,8,PALETTE.green,true);
    other.wrap(r?label(r):'Tiada rekod sah',31,y+21,330,9,PALETTE.navy,true,11);
    if(r)other.text(LEVELS.map(x=>x.slice(0,1)+': '+rangeLabel(r.levels[x])).join(' | '),31,y+47,7.4,PALETTE.muted);
  });
  other.text('KAEDAH & PENAFIAN',22,547,10,PALETTE.navy,true);
  other.wrap('Julat min-maks mengikut varieti, gred, unit dan peringkat. Harga kosong bukan RM0. Rekod pindaan tidak dikira dua kali. Tiada data diisi secara anggaran. Ini bukan harga transaksi atau nasihat jual beli.',22,565,349,8,PALETTE.muted,false,12);
  return doc.finish();
}

function directory(doc,{title,anchor,parent,date,crumb,items,root='cover',state='',district=''}){
  const chunkSize=18;
  for(let offset=0;offset<items.length||offset===0;offset+=chunkSize){
    const p=newPage(doc,offset?null:title,{anchor:offset?undefined:anchor,parent});
    doc.decorate(p,{date,breadcrumbs:crumb,root,state,district});
    p.wrap(title,23,129,350,19,PALETTE.navy,true,23);
    p.text(`${items.length} pilihan`,23,174,10,PALETTE.muted);
    simpleRows(p,items.slice(offset,offset+chunkSize),204,{font:9.5,step:24});
    if(items.length>chunkSize)p.text(`Senarai ${offset+1}-${Math.min(offset+chunkSize,items.length)} / ${items.length}`,23,646,8,PALETTE.muted);
  }
}

function fullReport(rows,{from,to,state,level,canonical}){
  if(rows.length>6500)throw Error('Full Mobile PDF terhad kepada 6,500 rekod sumber. Pilih tarikh atau negeri yang lebih singkat; Quick View menyokong tempoh lebih panjang.');
  const doc=new MobilePdf(),dates=[...new Set(rows.map(r=>r.tarikh_harga))].sort();
  const cover=newPage(doc,'Full Report',{anchor:'cover'});doc.decorate(cover,{date:periodText(from,to),root:'cover'});
  cover.text('FULL MOBILE REPORT',22,129,12,PALETTE.green,true);
  cover.wrap('HARGA PASARAN PERTANIAN MALAYSIA',22,172,350,27,PALETTE.navy,true,37);
  cover.text('Ladang / Borong / Runcit',22,276,12,PALETTE.muted);
  cover.text(periodText(from,to),22,300,14,PALETTE.navy,true);
  cover.line(22,333,373,333,PALETTE.line);
  counter(cover,24,350,String(dates.length),'TARIKH TINJAUAN');
  counter(cover,178,350,rows.length.toLocaleString('en-MY'),'REKOD SUMBER');
  cover.text('PILIH TARIKH',22,422,12,PALETTE.green,true);
  const dateItems=dates.slice(0,9).map(d=>({text:d,anchor:'date:'+d}));
  simpleRows(cover,dateItems,451,{font:9,step:22});
  if(dates.length>9){
    cover.text(`+ ${dates.length-9} tarikh lagi - lihat penanda buku PDF`,25,652,8,PALETTE.muted);
  }
  if(!dates.length)cover.text('Tiada rekod untuk pilihan ini.',22,460,11,PALETTE.muted);
  const valid=canonical,byDate=new Map();
  for(const row of rows){const date=row.tarikh_harga;if(!byDate.has(date))byDate.set(date,[]);byDate.get(date).push(row);}
  for(const date of dates){
    const dateRows=byDate.get(date),dateId='date:'+date;
    const states=sortedStates(new Set(dateRows.map(r=>r.negeri)));
    directory(doc,{title:'NEGERI / WILAYAH - '+date,anchor:dateId,parent:'cover',date,crumb:'Pilih negeri untuk melihat daerah',
      items:states.map(s=>({text:s,anchor:`state:${date}:${s}`}))});
    for(const name of states){
      const stateId=`state:${date}:${name}`,stateRows=dateRows.filter(r=>r.negeri===name);
      const districts=[...new Set(stateRows.map(r=>r.daerah))].sort();
      directory(doc,{title:name,anchor:stateId,parent:dateId,date,crumb:name,
        items:districts.map(d=>({text:d||'DAERAH TIDAK DINYATAKAN',anchor:`district:${date}:${name}:${d}`}))});
      for(const district of districts){
        const districtId=`district:${date}:${name}:${district}`,
          districtRows=stateRows.filter(r=>r.daerah===district);
        const locations=[...new Set(districtRows.map(r=>r.lokasi))].sort();
        directory(doc,{title:district||'DAERAH TIDAK DINYATAKAN',anchor:districtId,parent:stateId,date,
          crumb:name+' / '+(district||'-'),root:'cover',state:stateId,
          items:locations.map(loc=>({text:loc||'LOKASI TIDAK DINYATAKAN',anchor:`loc:${date}:${name}:${district}:${loc}`}))});
        for(const loc of locations){
          const locId=`loc:${date}:${name}:${district}:${loc}`,
            locRows=districtRows.filter(r=>r.lokasi===loc),validIds=new Set(valid.filter(r=>
              r.tarikh_harga===date&&r.negeri===name&&r.daerah===district&&r.lokasi===loc).map(r=>r));
          const groups=new Map();
          for(const record of locRows){
            const identity=key(record,['varieti','gred','unit','kategori']);
            if(!groups.has(identity))groups.set(identity,[]);
            groups.get(identity).push(record);
          }
          let p=newPage(doc,loc||'LOKASI TIDAK DINYATAKAN',{anchor:locId,parent:districtId});
          doc.decorate(p,{date,breadcrumbs:[name,district,loc].filter(Boolean).join(' / '),root:'cover',state:stateId,district:districtId});
          const titleEnd=p.wrap(loc||'LOKASI TIDAK DINYATAKAN',22,126,350,17,PALETTE.navy,true,21);
          p.text(`${locRows.length} rekod sumber | Pindaan ditanda, harga kosong dikekalkan`,22,Math.max(174,titleEnd+6),8,PALETTE.muted);
          let y=Math.max(205,titleEnd+37);
          for(const productRows of groups.values()){
            const canonicalProduct=productRows.filter(r=>validIds.has(r));
            // Split exceptionally long market product cards while retaining every raw record.
            for(let offset=0;offset<productRows.length;offset+=10){
              const part=productRows.slice(offset,offset+10);
              const h=76+part.length*13;
              if(y+h>648){
                p=newPage(doc,null);doc.decorate(p,{date,breadcrumbs:[name,district,loc].filter(Boolean).join(' / '),root:'cover',state:stateId,district:districtId});
                p.text('REKOD PASARAN (SAMBUNGAN)',22,133,14,PALETTE.navy,true);y=174;
              }
              p.fill(21,y,354,h,PALETTE.light);
              p.wrap(label(productRows[0]),30,y+7,337,9.5,PALETTE.navy,true,11);
              p.text(String(productRows[0].kategori||'Kategori tidak dinyatakan'),30,y+30,8,PALETTE.muted);
              LEVELS.forEach((name,j)=>{
                const values=canonicalProduct.filter(r=>r.peringkat===name).map(price).filter(v=>v!==null);
                const rng=values.length?{min:Math.min(...values),max:Math.max(...values)}:null;
                p.text(name.toUpperCase(),31+j*116,y+45,7,[PALETTE.green,PALETTE.gold,PALETTE.blue][j],true);
                p.text(rangeLabel(rng),31+j*116,y+57,8,PALETTE.ink,true);
              });
              part.forEach((r,i)=>p.text(`${r.peringkat} ${money(price(r))} | ID ${r.priceid||'-'}${validIds.has(r)?'':' [PINDAAN]'}`,
                30,y+73+i*13,7.5,PALETTE.muted));
              y+=h+10;
            }
          }
        }
      }
    }
  }
  return doc.finish();
}

export function buildFamaPdf(records,{from,to,state='',level='',type='quick',superseded={}}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)
    throw Error('Invalid PDF date range');
  if(!Array.isArray(records)||!records.length)throw Error('No FAMA records for PDF');
  if(records.some(r=>r.tarikh_harga<from||r.tarikh_harga>to))throw Error('PDF date mismatch');
  const canonical=canonicalPdfRows(records,superseded),rows=orderRows(records);
  if(type==='quick')return quickReport(rows,{from,to,state,level,canonical});
  if(type==='full')return fullReport(rows,{from,to,state,level,canonical});
  throw Error('Unknown PDF report type');
}

export function downloadPdf(bytes,filename){
  const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=filename;
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
