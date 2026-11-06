/* Pure BG Agro V3 data transforms. No browser globals or external libraries. */
export const FAMA_COLUMNS = [
  'priceid','tarikh_harga','systemdate','negeri','daerah','lokasi','peringkat',
  'sublevel','kategori','kumpulan','jenis','varieti','gred','unit',
  'harga','average14','supply'
];
export const PRICE_LEVELS = ['Ladang','Borong','Runcit'];

// Keep V3.1's browser identity identical to scraper.market_math.product_key.
export function productIdentity(row) {
  return ['varieti','gred','unit'].map(key=>String(row?.[key]??'').trim()).join('||');
}

// Apply the same latest-in-file priceid rule as the Python archive canonicalizer.
// Rows without priceid are retained; blanks remain visible in original records.
export function canonicalDailyRows(rows, excludedPriceIds=[]) {
  const excluded=new Set(excludedPriceIds.map(String)),last=new Map();
  rows.forEach((row,index)=>{
    const id=String(row.priceid??'').trim();
    if(id)last.set(id,index);
  });
  return rows.filter((row,index)=>{
    const id=String(row.priceid??'').trim();
    return !id||(!excluded.has(id)&&last.get(id)===index);
  });
}

export function productAreaRows(rows, {productKey,state='',district='',location='',excludedPriceIds=[]}={}) {
  return canonicalDailyRows(rows,excludedPriceIds).filter(row=>
    productIdentity(row)===productKey&&(!state||row.negeri===state)&&
    (!district||row.daerah===district)&&(!location||row.lokasi===location));
}

// A single distinct market votes once, even when multiple FAMA entries exist.
// Always keep levels separate. Never substitute a state mean for a locality.
export function localLevelPrices(rows) {
  const byLevel=new Map();
  for(const row of rows){
    const price=validPrice(row.harga),level=String(row.peringkat??'').trim();
    if(price===null||!PRICE_LEVELS.includes(level))continue;
    if(!byLevel.has(level))byLevel.set(level,new Map());
    const markets=byLevel.get(level);
    const market=['negeri','daerah','lokasi','sublevel'].map(k=>String(row[k]??'').trim()).join('||');
    const bucket=markets.get(market)||{sum:0,count:0};
    bucket.sum+=price;bucket.count++;markets.set(market,bucket);
  }
  return PRICE_LEVELS.map(level=>{
    const markets=byLevel.get(level);
    if(!markets?.size)return {level,price:null,markets:0,observations:0};
    const averages=[...markets.values()].map(v=>v.sum/v.count);
    return {level,price:averages.reduce((a,b)=>a+b,0)/averages.length,
      markets:markets.size,observations:[...markets.values()].reduce((sum,v)=>sum+v.count,0)};
  });
}

export function productScopePrices(prices, rows, {productKey,state='',district='',location='',excludedPriceIds=[]}={}) {
  if(district||location){
    // A district/market quote is *never* silently replaced with a state quote.
    if(!state||!district||!Array.isArray(rows))return null;
    return localLevelPrices(productAreaRows(rows,{productKey,state,district,location,excludedPriceIds}));
  }
  return PRICE_LEVELS.map(level=>{
    const q=prices.find(p=>p.product_key===productKey&&p.level===level&&p.state===state);
    return {level,price:q?.price??null,markets:q?.markets??0,observations:q?.observations??0};
  });
}

export function productAreaOptions(rows, {productKey,state='',district='',excludedPriceIds=[]}={}) {
  const matching=productAreaRows(rows,{productKey,state,district,excludedPriceIds});
  const names=(key)=>[...new Set(matching.map(r=>String(r[key]??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  return {districts:state?names('daerah'):[],locations:state&&district?names('lokasi'):[]};
}

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
