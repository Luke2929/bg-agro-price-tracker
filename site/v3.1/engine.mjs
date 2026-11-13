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

// Sort only price comparisons that are actually visible and eligible in the table.
// This never interprets missing baseline data as 0% or mixes different states.
export function sortQuotesByChange(quotes,{period=7,order='name'}={}) {
  if(order==='name'||!['rise','fall','swing'].includes(order)||![1,7,30].includes(Number(period)))
    return [...quotes];
  const rows=quotes.map((quote,index)=>({quote,index,percent:quoteChange(quote,period)?.percent}))
    .filter(row=>Number.isFinite(row.percent)&&
      (order==='rise'?row.percent>0:order==='fall'?row.percent<0:true));
  rows.sort((a,b)=>{
    const difference=order==='rise'?b.percent-a.percent:
      order==='fall'?a.percent-b.percent:Math.abs(b.percent)-Math.abs(a.percent);
    return difference||a.index-b.index;
  });
  return rows.map(row=>row.quote);
}

// Collapse display rows by the *full* product identity and selected geography.
// A group is only a view: its price levels are never averaged together.
// When ranking, the strongest eligible level determines the product's position;
// the other levels remain visible for context (even if their direction differs).
export function groupQuotesByProduct(quotes,{period=7,order='name'}={}) {
  const keyOf=p=>JSON.stringify([
    p.product_key||[p.varieti,p.gred,p.unit].map(v=>String(v??'').trim()).join('||'),
    String(p.state??'')
  ]);
  const groups=new Map();
  for(const quote of quotes){
    const key=keyOf(quote);
    if(!groups.has(key))groups.set(key,{key,quotes:[],leader:null});
    groups.get(key).quotes.push(quote);
  }
  const byLevel={Ladang:0,Borong:1,Runcit:2};
  for(const group of groups.values()){
    group.quotes.sort((a,b)=>
      (byLevel[a.level]??99)-(byLevel[b.level]??99)||
      String(a.level).localeCompare(String(b.level)));
  }
  if(order==='name'||!['rise','fall','swing'].includes(order))
    return [...groups.values()];
  const ranked=sortQuotesByChange(quotes,{period,order});
  const ordered=[];
  const seen=new Set();
  for(const quote of ranked){
    const key=keyOf(quote);
    if(seen.has(key))continue;
    seen.add(key);
    const group=groups.get(key);
    group.leader=quote;
    ordered.push(group);
  }
  return ordered;
}


// Generate a selected-day V3-compatible price table using only actual archive rows.
// This deliberately mirrors scraper.aggregate_v3 + MatchedMarketComparator rather
// than subtracting unmatched nationwide/state-level means.
export function archiveComparisonDates(archiveDates, surveyDate) {
  if(!Array.isArray(archiveDates)||!archiveDates.includes(surveyDate))return [];
  const needed=new Set([surveyDate]);
  const periods={1:6,7:4,30:7};
  const available=new Set(archiveDates);
  for(const [daysText,backtrack] of Object.entries(periods)){
    const days=Number(daysText);
    for(let step=days;step<=days+backtrack;step++){
      const date=shiftSurveyDate(surveyDate,-step);
      if(available.has(date))needed.add(date);
    }
  }
  return [...needed].sort((a,b)=>b.localeCompare(a));
}

export function shiftSurveyDate(iso,deltaDays) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))throw Error('FAMA 调查日期格式无效');
  const instant=Date.parse(iso+'T12:00:00Z');
  if(!Number.isFinite(instant))throw Error('FAMA 调查日期无效');
  return new Date(instant+deltaDays*86400000).toISOString().slice(0,10);
}

// Each priceid's final row within its CSV wins, and the global archive
// revision manifest excludes superseded historic priceids. Those rules are
// required for parity with the production Python canonicalizer.
export function buildPriceDateSnapshot(rowsByDate,{surveyDate,archiveDates,supersededByDate={}}={}) {
  if(!(rowsByDate instanceof Map)||!Array.isArray(archiveDates)||!archiveDates.includes(surveyDate))
    throw Error('选中的调查日期不在已归档的 FAMA 日期中');
  const needed=archiveComparisonDates(archiveDates,surveyDate);
  for(const day of needed){
    if(!rowsByDate.has(day)||!Array.isArray(rowsByDate.get(day)))
      throw Error('缺少历史原始 CSV，无法可靠计算：'+day);
  }

  // Date -> level -> full product identity -> full market identity -> {sum,count}
  const days=new Map(),categories=new Map(),labels=new Map();
  const scopes=new Map();
  let validLatestRows=0,latestRows=0;
  const composite=(values)=>JSON.stringify(values);
  for(const day of needed){
    const raw=rowsByDate.get(day);
    if(raw.some(row=>row.tarikh_harga!==day))
      throw Error(day+' 原始 CSV 存在调查日期不匹配');
    const canonical=canonicalDailyRows(raw,supersededByDate[day]||[]);
    const levels=new Map();
    days.set(day,levels);
    for(const row of canonical){
      if(day===surveyDate)latestRows++;
      const price=validPrice(row.harga),level=String(row.peringkat||'').trim(),
        variety=String(row.varieti||'').trim();
      if(price===null||!PRICE_LEVELS.includes(level)||!variety)continue;
      if(day===surveyDate)validLatestRows++;
      const product=productIdentity(row);
      const state=String(row.negeri||'').trim();
      const market=['negeri','daerah','lokasi','sublevel']
        .map(key=>String(row[key]??'').trim()).join('||');
      if(!levels.has(level))levels.set(level,new Map());
      const products=levels.get(level);
      if(!products.has(product))products.set(product,new Map());
      const locations=products.get(product);
      const bucket=locations.get(market)||{sum:0,count:0};
      bucket.sum+=price;bucket.count++;
      locations.set(market,bucket);
      if(day!==surveyDate)continue;
      if(!labels.has(product))labels.set(product,{
        product_key:product,varieti:variety,
        gred:String(row.gred||'').trim(),unit:String(row.unit||'').trim()
      });
      if(!categories.has(product))categories.set(product,new Map());
      const category=String(row.kategori||'').trim();
      const counts=categories.get(product);
      counts.set(category,(counts.get(category)||0)+1);
      for(const scope of state?['',state]:['']){
        const key=composite([product,level,scope]);
        if(!scopes.has(key))scopes.set(key,{product,level,state:scope,rows:[]});
        scopes.get(key).rows.push(row);
      }
    }
  }

  const scopedMarkets=(day,level,product,state)=>{
    const all=days.get(day)?.get(level)?.get(product);
    if(!all)return null;
    if(!state)return all;
    const prefix=state+'||';
    const selected=new Map([...all].filter(([key])=>key.startsWith(prefix)));
    return selected.size?selected:null;
  };
  const averageFor=(markets)=>{
    const averages=[...markets.values()].map(bucket=>bucket.sum/bucket.count);
    return averages.reduce((a,b)=>a+b,0)/averages.length;
  };
  const compare=(group,period)=>{
    const current=scopedMarkets(surveyDate,group.level,group.product,group.state);
    if(!current?.size)return null;
    const target=shiftSurveyDate(surveyDate,-period);
    const backtrack={1:6,7:4,30:7}[period];
    const earliest=shiftSurveyDate(target,-backtrack);
    for(const previousDate of needed){
      if(previousDate>target||previousDate<earliest)continue;
      const previous=scopedMarkets(previousDate,group.level,group.product,group.state);
      if(!previous?.size)continue;
      let matched=0,nowTotal=0,oldTotal=0;
      for(const [key,now] of current){
        const before=previous.get(key);
        if(!before||!now.count||!before.count)continue;
        nowTotal+=now.sum/now.count;
        oldTotal+=before.sum/before.count;
        matched++;
      }
      if(!matched)continue;
      const nowMean=nowTotal/matched,oldMean=oldTotal/matched;
      if(oldMean<=0)continue;
      const rawPercent=(nowMean-oldMean)/oldMean*100;
      return {
        current:nowMean,previous:oldMean,rmDifference:nowMean-oldMean,
        percent:Math.abs(rawPercent)<0.05?0:rawPercent,
        markets:matched,currentDate:surveyDate,previousDate,
        days:period,actualDays:Math.round((Date.parse(surveyDate)-Date.parse(previousDate))/86400000),
        currentMarkets:current.size,previousMarkets:previous.size,
        currentCoverage:matched/current.size,previousCoverage:matched/previous.size,
        eligible:matched>=3&&matched/current.size>=0.5&&matched/previous.size>=0.5
      };
    }
    return null;
  };

  const prices=[];
  const states=new Set();
  for(const group of scopes.values()){
    const markets=scopedMarkets(surveyDate,group.level,group.product,group.state);
    if(!markets?.size)continue;
    const label=labels.get(group.product),countByCategory=categories.get(group.product);
    const category=[...countByCategory].sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
    if(group.state)states.add(group.state);
    prices.push({
      ...label,kategori:category,level:group.level,state:group.state,
      date:surveyDate,price:averageFor(markets),
      observations:group.rows.length,markets:markets.size,
      changes:Object.fromEntries([1,7,30].map(period=>[String(period),compare(group,period)]))
    });
  }
  prices.sort((a,b)=>a.product_key.localeCompare(b.product_key)||
    a.level.localeCompare(b.level)||a.state.localeCompare(b.state));
  return {
    schema:'bg-agro/fama-overview/v3',survey_date:surveyDate,
    latest_survey_rows:latestRows,valid_latest_rows:validLatestRows,
    states:[...states].sort(),prices
  };
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
