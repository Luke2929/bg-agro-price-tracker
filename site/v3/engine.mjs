/* Pure BG Agro V3 data transforms. No browser globals or external libraries. */
export const FAMA_COLUMNS = [
  'priceid','tarikh_harga','systemdate','negeri','daerah','lokasi','peringkat',
  'sublevel','kategori','kumpulan','jenis','varieti','gred','unit',
  'harga','average14','supply'
];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

export function fmtMoney(value) {
  return Number.isFinite(value) ? 'RM ' + value.toLocaleString('en-MY',
    {minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
}

export function fmtDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso : '—';
}

export function ageDays(iso, today) {
  const a = Date.parse(`${iso}T00:00:00Z`), b = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.floor((b-a)/86400000) : null;
}

export function mytDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function quoteChange(quote, period) {
  const changed = quote?.changes?.[String(period)];
  return changed?.eligible && Number.isFinite(changed.percent) ? changed : null;
}

export function rankMovers(prices, period, direction, limit = 5) {
  return prices.filter(p=>p.state==='').map(p=>({...p, change:quoteChange(p,period)}))
    .filter(p=>p.change && (direction==='up' ? p.change.percent>0 : p.change.percent<0))
    .sort((a,b)=>direction==='up' ? b.change.percent-a.change.percent : a.change.percent-b.change.percent)
    .slice(0,limit);
}

export function filterQuotes(prices, {search='',level='',state='',category=''}={}) {
  const needle=search.trim().toLocaleUpperCase();
  return prices.filter(p=>p.state===state && (!level||p.level===level) &&
    (!category||p.kategori===category) &&
    (!needle||[p.varieti,p.gred,p.unit].some(v=>String(v).toLocaleUpperCase().includes(needle))))
    .sort((a,b)=>a.varieti.localeCompare(b.varieti)||a.gred.localeCompare(b.gred)||a.level.localeCompare(b.level));
}

export function productLabel(item) {
  return [item?.varieti,item?.gred,item?.unit].filter(Boolean).join(' · ');
}

export function historySeries(history, {level='Borong',state='',days=90,endDate}={}) {
  if (!history || !Array.isArray(history.observations) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate||'')) return [];
  const end = Date.parse(endDate+'T12:00:00Z');
  const start = new Date(end-(days-1)*86400000).toISOString().slice(0,10);
  return history.observations.filter(o=>o.level===level && o.state===state &&
    o.date>=start && o.date<=endDate && Number.isFinite(o.price))
    .sort((a,b)=>a.date.localeCompare(b.date));
}

export function statePrices(prices, productKey, level) {
  return prices.filter(p=>p.product_key===productKey && p.level===level && p.state)
    .sort((a,b)=>b.price-a.price);
}

export function parseCSV(input) {
  const text=String(input??'').replace(/^\uFEFF/,'');
  const output=[];let headers=null,positions=[],cells=[],field='',quoted=false;
  const finish=()=>{
    cells.push(field);field='';
    if(cells.every(value=>value==='')){cells=[];return;}
    if(headers===null){
      headers=cells.map(v=>v.trim().toLowerCase());
      const required=['priceid','tarikh_harga','negeri','lokasi','peringkat','varieti','gred','unit','harga'];
      if(required.some(name=>!headers.includes(name))) throw Error('FAMA CSV 缺少必需字段');
      positions=FAMA_COLUMNS.map(name=>headers.indexOf(name));
    }else{
      const item={};
      FAMA_COLUMNS.forEach((name,i)=>item[name]=positions[i]<0?'':String(cells[positions[i]]??'').trim());
      output.push(item);
    }
    cells=[];
  };
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"') quoted=false;else field+=ch;}
    else if(ch==='"') quoted=true;else if(ch===','){cells.push(field);field='';}
    else if(ch==='\r'||ch==='\n'){finish();if(ch==='\r'&&text[i+1]==='\n')i++;}
    else field+=ch;
  }
  if(quoted)throw Error('FAMA CSV 引号未正确闭合');
  if(field!==''||cells.length)finish();
  return output;
}

export function validPrice(value) {
  if(String(value??'').trim()==='')return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>=0 ? number : null;
}

export function summarizeRows(rows, supersededByDate = {}) {
  const excluded = new Set(Object.entries(supersededByDate).flatMap(([date,ids])=>
    (Array.isArray(ids)?ids:[]).map(id=>`${date}|${id}`)));
  const seen = new Set();
  const groups = new Map();
  for(const r of rows){
    const date=r.tarikh_harga,id=String(r.priceid||'');
    if(id && (excluded.has(`${date}|${id}`)||seen.has(`${date}|${id}`)))continue;
    if(id)seen.add(`${date}|${id}`);
    const price=validPrice(r.harga);
    if(price===null||!date||!r.varieti||!['Ladang','Borong','Runcit'].includes(r.peringkat))continue;
    const groupKey=[date,r.varieti,r.gred,r.unit,r.peringkat,r.negeri].join('\u001F');
    const marketKey=[r.negeri,r.daerah,r.lokasi,r.sublevel].join('\u001F');
    if(!groups.has(groupKey))groups.set(groupKey,{r,markets:new Map()});
    const markets=groups.get(groupKey).markets;
    const bucket=markets.get(marketKey)||{sum:0,count:0};
    bucket.sum+=price;bucket.count++;markets.set(marketKey,bucket);
  }
  const output=[];
  for(const {r,markets} of groups.values()){
    const averages=[...markets.values()].map(m=>m.sum/m.count);
    output.push({
      date:r.tarikh_harga,varieti:r.varieti,gred:r.gred,unit:r.unit,
      level:r.peringkat,state:r.negeri,price:averages.reduce((a,b)=>a+b,0)/averages.length,
      markets:averages.length,observations:[...markets.values()].reduce((n,m)=>n+m.count,0),
      category:r.kategori
    });
  }
  return output.sort((a,b)=>a.date.localeCompare(b.date)||a.state.localeCompare(b.state)||a.varieti.localeCompare(b.varieti));
}
