/* Minimal offline OOXML XLSX writer: no CDN dependencies or spreadsheet formulas. */
const enc=new TextEncoder();
const xmlHeader='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationships='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationships='http://schemas.openxmlformats.org/package/2006/relationships';
const crcTable=Array.from({length:256},(_,n)=>{
  let c=n;for(let i=0;i<8;i++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;
  return c>>>0;
});
const crc32=bytes=>{
  let c=0xFFFFFFFF;for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
};
const xmlEsc=value=>String(value??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'')
  .replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
function letter(col){let s='';for(let n=col+1;n>0;n=Math.floor((n-1)/26)){s=String.fromCharCode(65+(n-1)%26)+s;}return s;}
function excelCell(value,row,col,header=false){
  const address=letter(col)+row;
  if(typeof value==='number'&&Number.isFinite(value)&&!header)
    return `<c r="${address}"><v>${value}</v></c>`;
  const style=header?' s="1"':'';
  // Inline strings intentionally prevent source-cell CSV formula injection.
  return `<c r="${address}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
}
function sheetXml(headers,rows){
  const body=[xmlHeader,`<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>`];
  body.push('<row r="1">'+headers.map((h,i)=>excelCell(h,1,i,true)).join('')+'</row>');
  for(let i=0;i<rows.length;i++){
    if(rows[i].length!==headers.length)throw Error('Invalid Excel row length');
    body.push(`<row r="${i+2}">`+rows[i].map((v,j)=>excelCell(v,i+2,j)).join('')+'</row>');
  }
  body.push(`</sheetData><autoFilter ref="A1:${letter(headers.length-1)}${rows.length+1}"/></worksheet>`);
  return body.join('');
}
function zip(entries){
  const locals=[],central=[];let offset=0,centralBytes=0;
  for(const [path,body] of entries){
    const name=enc.encode(path),data=enc.encode(body);
    if(name.length>65535||data.length>0xFFFFFFFF||offset>0xFFFFFFFF)throw Error('Excel too large');
    const crc=crc32(data);
    const local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034B50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);
    lv.setUint16(8,0,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);
    lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);
    const cd=new Uint8Array(46+name.length),cv=new DataView(cd.buffer);
    cv.setUint32(0,0x02014B50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);
    cv.setUint16(8,0x800,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);
    cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);
    cd.set(name,46);locals.push(local,data);central.push(cd);
    offset+=local.length+data.length;centralBytes+=cd.length;
  }
  if(offset+centralBytes>0xFFFFFFFF)throw Error('Excel is over ZIP size limit');
  const end=new Uint8Array(22),ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054B50,true);ev.setUint16(8,entries.length,true);
  ev.setUint16(10,entries.length,true);ev.setUint32(12,centralBytes,true);
  ev.setUint32(16,offset,true);
  return new Blob([...locals,...central,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

export function buildXlsx(headers,rows,{sheetName='FAMA Prices',notes=[]}={}){
  if(!Array.isArray(headers)||!headers.length||headers.length>16384||
     !Array.isArray(rows)||rows.length>150000)
    throw Error('Excel limit exceeded. Please export shorter date ranges (maximum 150,000 rows).');
  if(!/^[^\\/*?:\[\]]{1,31}$/.test(sheetName))throw Error('Invalid worksheet name');
  const sheets=[sheetName];
  const files=[['xl/worksheets/sheet1.xml',sheetXml(headers,rows)]];
  if(notes.length){
    sheets.push('Data Notes');
    files.push(['xl/worksheets/sheet2.xml',sheetXml(['Field','Description'],notes)]);
  }
  const book=xmlHeader+`<workbook xmlns="${main}" xmlns:r="${relationships}"><sheets>`+
    sheets.map((name,i)=>`<sheet name="${xmlEsc(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>';
  const rels=xmlHeader+`<Relationships xmlns="${packageRelationships}">`+
    sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${relationships}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+
    `<Relationship Id="rId${sheets.length+1}" Type="${relationships}/styles" Target="styles.xml"/></Relationships>`;
  const types=xmlHeader+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
    sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>';
  const styles=xmlHeader+`<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF28644C"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  files.push(['[Content_Types].xml',types]);
  files.push(['_rels/.rels',xmlHeader+`<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  files.push(['xl/workbook.xml',book],['xl/_rels/workbook.xml.rels',rels],['xl/styles.xml',styles]);
  return zip(files);
}

export function downloadXlsx(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
