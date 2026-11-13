/* Pure BG Agro V3 data transforms. No browser globals or external libraries. */
export const FAMA_COLUMNS = [
  'priceid','tarikh_harga','systemdate','negeri','daerah','lokasi','peringkat',
  'sublevel','kategori','kumpulan','jenis','varieti','gred','unit',
  'harga','average14','supply'
];
export const PRICE_LEVELS = ['Ladang','Borong','Runcit'];
const COMPARISON_WINDOWS = {1:6,7:4,30:7};
const MARKET_FIELDS = ['negeri','daerah','lokasi','sublevel'];
const DECIMAL_PRICE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const SOURCE_REVIEW_RATIO=10,MARKET_REVIEW_RATIO=2,MARKET_REVIEW_POINTS=10;

export function sourcePriceNeedsReview(row,price=validPrice(row.harga)){
  const reference=validPrice(row.average14);
  return price!==null&&reference>0&&price>=reference*SOURCE_REVIEW_RATIO;
}

function marketNeedsReview(now,before,nowTotal,beforeTotal,percent){
  if(now===before||Math.max(now,before)<Math.min(now,before)*MARKET_REVIEW_RATIO)return false;
  const remainingBefore=beforeTotal-before;
  if(remainingBefore<=0)return true;
  const withoutMarket=(nowTotal-now-remainingBefore)/remainingBefore*100;
  return Math.abs(percent-withoutMarket)>=MARKET_REVIEW_POINTS;
}

// Keep V3.1's browser identity identical to scraper.market_math.product_key.
export function productIdentity(row) {
  return ['varieti','gred','unit'].map(key=>
    String(row?.[key]??'').trim().replaceAll('%','%25').replaceAll('|','%7C')).join('||');
}

function addMarket(markets,row,price){
  const identity=MARKET_FIELDS.map(key=>String(row[key]??'').trim());
  const key=JSON.stringify(identity);
  const bucket=markets.get(key)||{identity,sum:0,count:0,review:false};
  bucket.sum+=price;
  bucket.count++;
  bucket.review ||= sourcePriceNeedsReview(row,price);
  markets.set(key,bucket);
}

function marketMean(markets){
  return [...markets.values()].reduce((sum,bucket)=>sum+bucket.sum/bucket.count,0)/markets.size;
}

function marketGroups(rows){
  const levels=new Map();
  for(const row of rows){
    const price=validPrice(row.harga),level=String(row.peringkat??'').trim();
    if(price===null||!PRICE_LEVELS.includes(level)||!String(row.varieti??'').trim())continue;
    const product=productIdentity(row);
    if(!levels.has(level))levels.set(level,new Map());
    const products=levels.get(level);
    if(!products.has(product))products.set(product,new Map());
    addMarket(products.get(product),row,price);
  }
  return levels;
}

function marketsInScope(markets,state){
  return state&&markets?new Map([...markets].filter(([,bucket])=>bucket.identity[0]===state)):markets;
}

function matchedMarketStats(current,previous,includeDetails=false){
  if(!current?.size||!previous?.size)return null;
  let currentTotal=0,previousTotal=0;
  const pairs=[];
  const details=[];
  for(const [key,now] of current){
    const before=previous.get(key);
    if(!before)continue;
    const currentMean=now.sum/now.count,previousMean=before.sum/before.count;
    currentTotal+=currentMean;
    previousTotal+=previousMean;
    const sourceReview=now.review||before.review;
    pairs.push({currentMean,previousMean,sourceReview});
    if(includeDetails){
      const [state,district,location,sublevel]=now.identity;
      const difference=currentMean-previousMean;
      details.push({state,district,location,sublevel,currentMean,previousMean,difference,
        percent:previousMean>0?difference/previousMean*100:null,
        currentObservations:now.count,previousObservations:before.count,sourceReview});
    }
  }
  const count=pairs.length;
  if(!count||previousTotal<=0)return null;
  const now=currentTotal/count,before=previousTotal/count;
  const rmDifference=now-before,rawPercent=rmDifference/before*100;
  const currentCoverage=count/current.size,previousCoverage=count/previous.size;
  const marketImpact=({currentMean,previousMean})=>count>=3&&
    marketNeedsReview(currentMean,previousMean,currentTotal,previousTotal,rawPercent);
  const reviewReasons=[
    pairs.some(pair=>pair.sourceReview)&&'source-price',
    pairs.some(marketImpact)&&'market-impact'
  ].filter(Boolean);
  return {
    current:now,previous:before,rmDifference,rawPercent,
    percent:Math.abs(rawPercent)<0.05?0:rawPercent,
    markets:count,currentMarkets:current.size,previousMarkets:previous.size,
    currentCoverage,previousCoverage,
    eligible:count>=3&&currentCoverage>=0.5&&previousCoverage>=0.5,
    ...(reviewReasons.length?{reviewReasons}:{}),
    ...(includeDetails?{details:details.map(row=>({...row,marketImpact:marketImpact(row)}))}:{})
  };
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
    productIdentity(row)===productKey&&(!state||String(row.negeri??'').trim()===state)&&
    (!district||String(row.daerah??'').trim()===district)&&(!location||String(row.lokasi??'').trim()===location));
}

// A single distinct market votes once, even when multiple FAMA entries exist.
// Always keep levels separate. Never substitute a state mean for a locality.
export function localLevelPrices(rows) {
  const byLevel=new Map();
  for(const row of rows){
    const price=validPrice(row.harga),level=String(row.peringkat??'').trim();
    if(price===null||!PRICE_LEVELS.includes(level))continue;
    if(!byLevel.has(level))byLevel.set(level,new Map());
    addMarket(byLevel.get(level),row,price);
  }
  return PRICE_LEVELS.map(level=>{
    const markets=byLevel.get(level);
    if(!markets?.size)return {level,price:null,markets:0,observations:0};
    return {level,price:marketMean(markets),
      markets:markets.size,observations:[...markets.values()].reduce((sum,v)=>sum+v.count,0),
      ...([...markets.values()].some(bucket=>bucket.review)?{priceReview:true}:{})};
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
    return {level,price:q?.price??null,markets:q?.markets??0,observations:q?.observations??0,
      ...(q?.priceReview?{priceReview:true}:{})};
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

export function isValidISODate(day){
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day.startsWith('0000'))return false;
  const timestamp=Date.parse(day+'T00:00:00Z');
  return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===day;
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

export function comparisonReviewReasons(change){
  return [
    ...(Math.abs(change?.percent)>=50?['large-change']:[]),
    ...(change?.reviewReasons||[]).filter(reason=>reason!=='large-change')
  ];
}

function equalNumber(a,b){
  return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(b));
}

// Public claims use these paired-market prices, never the quote's all-market price.
export function comparisonEvidence(quote,period,surveyDate=quote?.date){
  const change=quoteChange(quote,period);
  if(!change||![1,7,30].includes(period)||!isValidISODate(surveyDate)||
    !isValidISODate(change.previousDate)||change.currentDate!==surveyDate||
    quote.date!==surveyDate||change.days!==period||
    typeof quote.state!=='string'||!quote.varieti||typeof quote.gred!=='string'||!quote.unit||
    !PRICE_LEVELS.includes(quote.level)||quote.product_key!==productIdentity(quote))return null;
  const {previous,current,rmDifference,percent,markets,currentMarkets,previousMarkets}=change;
  const actualDays=ageDays(change.previousDate,surveyDate);
  if(actualDays!==change.actualDays||actualDays<period||actualDays>period+COMPARISON_WINDOWS[period]||
    !Number.isInteger(markets)||markets<3||!Number.isInteger(currentMarkets)||
    !Number.isInteger(previousMarkets)||currentMarkets<markets||previousMarkets<markets||
    markets/currentMarkets<0.5||markets/previousMarkets<0.5||
    !equalNumber(change.currentCoverage,markets/currentMarkets)||
    !equalNumber(change.previousCoverage,markets/previousMarkets)||
    !Number.isFinite(previous)||previous<=0||!Number.isFinite(current)||current<0)return null;
  const rawPercent=(current-previous)/previous*100;
  if(!equalNumber(rmDifference,current-previous)||
    !equalNumber(percent,Math.abs(rawPercent)<0.05?0:rawPercent)||
    (change.rawPercent!==undefined&&!equalNumber(change.rawPercent,rawPercent)))return null;
  return {
    productKey:quote.product_key,product:quote.varieti,grade:quote.gred,unit:quote.unit,
    level:quote.level,region:quote.state,period,actualDays,
    currentDate:surveyDate,previousDate:change.previousDate,
    currentMean:current,previousMean:previous,rmDifference,percent,rawPercent,markets,
    currentMarkets,previousMarkets,currentCoverage:change.currentCoverage,
    previousCoverage:change.previousCoverage,reviewReasons:comparisonReviewReasons(change)
  };
}

export function comparisonMarketDetails(rowsByDate,evidence,supersededByDate={}){
  const {currentDate,previousDate,level,productKey,region}=evidence;
  if(!isValidISODate(previousDate)||!isValidISODate(currentDate)||previousDate>=currentDate||
    ageDays(previousDate,currentDate)!==evidence.actualDays||
    productIdentity({varieti:evidence.product,gred:evidence.grade,unit:evidence.unit})!==productKey||
    typeof region!=='string'||!PRICE_LEVELS.includes(level))
    throw Error('比较日期、产品或层级无法核对。');
  const marketsFor=day=>{
    const raw=rowsByDate.get(day);
    if(!Array.isArray(raw)||raw.some(row=>row.tarikh_harga!==day))
      throw Error(day+' 原始调查记录缺失或日期不一致。');
    const rows=canonicalDailyRows(raw,supersededByDate[day]||[]);
    return marketsInScope(marketGroups(rows).get(level)?.get(productKey),region);
  };
  const result=matchedMarketStats(marketsFor(currentDate),marketsFor(previousDate),true);
  if(!result?.eligible||result.markets!==evidence.markets||
    result.currentMarkets!==evidence.currentMarkets||result.previousMarkets!==evidence.previousMarkets||
    !equalNumber(result.current,evidence.currentMean)||!equalNumber(result.previous,evidence.previousMean)||
    !equalNumber(result.rmDifference,evidence.rmDifference)||!equalNumber(result.percent,evidence.percent)||
    !equalNumber(result.rawPercent,evidence.rawPercent))
    throw Error('原始市场均价未能与比较结果对账。请刷新数据后重试。');
  return result;
}

// Use one common market set across the whole sequence, with adequate coverage
// on each observed date. These are research signals, separate from 1/7/30D.
export function matchedMarketStreaks(rowsByDate,{state='',supersededByDate={}}={}){
  const dates=[...rowsByDate.keys()].sort();
  if(dates.length<3)return [];
  const days=dates.map(day=>marketGroups(canonicalDailyRows(rowsByDate.get(day),supersededByDate[day]||[])));
  const trends=[];
  for(const [level,products] of days.at(-1)){
    for(const [productKey] of products){
      const markets=days.map(day=>marketsInScope(day.get(level)?.get(productKey),state));
      if(markets.some(day=>!day?.size))continue;
      const keys=[...markets.at(-1).keys()].filter(key=>markets.every(day=>day.has(key)));
      if(keys.length<3||markets.some(day=>keys.length/day.size<0.5))continue;
      if(markets.some(day=>keys.some(key=>day.get(key).review)))continue;
      const prices=markets.map(day=>marketMean(new Map(keys.map(key=>[key,day.get(key)]))));
      const moves=prices.slice(1).map((price,index)=>
        prices[index]>0?(price-prices[index])/prices[index]*100:NaN);
      const rising=moves.every(move=>move>=0.05&&move<50);
      const falling=moves.every(move=>move<=-0.05&&move>-50);
      if(!rising&&!falling)continue;
      const concentrated=moves.some((move,index)=>keys.some(key=>{
        const current=markets[index+1].get(key),previous=markets[index].get(key);
        return marketNeedsReview(current.sum/current.count,previous.sum/previous.count,
          prices[index+1]*keys.length,prices[index]*keys.length,move);
      }));
      if(concentrated)continue;
      trends.push({productKey,level,markets:keys.length,direction:rising?'rise':'fall',
        points:dates.map((date,index)=>({date,price:prices[index]})),
        strength:Math.min(...moves.map(Math.abs))});
    }
  }
  return trends.sort((a,b)=>b.strength-a.strength||b.markets-a.markets);
}

export function rankMovers(prices, period, direction, limit = 5) {
  return prices.filter(p=>p.state==='').map(p=>({...p, change:quoteChange(p,period)}))
    .filter(p=>p.change && (direction==='up' ? p.change.percent>0 : p.change.percent<0))
    .sort((a,b)=>direction==='up' ? b.change.percent-a.change.percent : a.change.percent-b.change.percent)
    .slice(0,limit);
}

// Editorial discovery only: quoteChange() is the source of eligibility.
// Large moves remain observable but are not promoted into ready-to-post claims.
export function dailyStorySignals(prices,period=1) {
  const window=[1,7,30].includes(Number(period))?Number(period):1;
  const comparable=(Array.isArray(prices)?prices:[])
    .filter(quote=>quote.state===''&&quoteChange(quote,window));
  const extreme=comparable.filter(quote=>comparisonReviewReasons(quoteChange(quote,window)).length)
    .sort((a,b)=>Math.abs(b.changes[String(window)].percent)-
      Math.abs(a.changes[String(window)].percent));
  const editorial=comparable.filter(quote=>!comparisonReviewReasons(quoteChange(quote,window)).length);
  const focus=comparable.filter(quote=>{
    const change=quoteChange(quote,window);
    return Math.abs(change.percent)<50&&!change.reviewReasons?.includes('source-price');
  });
  const positives=focus.filter(q=>q.changes[String(window)].percent>0)
    .sort((a,b)=>b.changes[String(window)].percent-a.changes[String(window)].percent);
  const negatives=focus.filter(q=>q.changes[String(window)].percent<0)
    .sort((a,b)=>a.changes[String(window)].percent-b.changes[String(window)].percent);
  const products=new Map();
  for(const quote of editorial){
    const key=quote.product_key||productIdentity(quote);
    if(!products.has(key))products.set(key,new Map());
    products.get(key).set(quote.level,quote);
  }
  const aligned=[];
  for(const layers of products.values()){
    if(!PRICE_LEVELS.every(level=>layers.has(level)))continue;
    const levels=PRICE_LEVELS.map(level=>layers.get(level));
    if(new Set(levels.map(q=>quoteChange(q,window).previousDate)).size!==1)continue;
    const changes=levels.map(q=>q.changes[String(window)].percent);
    const direction=changes.every(value=>value>0)?'up':
      changes.every(value=>value<0)?'down':null;
    if(!direction)continue;
    aligned.push({
      product_key:levels[0].product_key||productIdentity(levels[0]),
      varieti:levels[0].varieti,levels,
      direction,strength:Math.min(...changes.map(Math.abs))
    });
  }
  aligned.sort((a,b)=>b.strength-a.strength||a.varieti.localeCompare(b.varieti));
  return {
    period:window,comparableCount:comparable.length,upCount:positives.length,
    downCount:negatives.length,rise:positives[0]||null,fall:negatives[0]||null,
    aligned:aligned[0]||null,extreme:extreme[0]||null,
    extremeCount:extreme.length
  };
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
    p.product_key||productIdentity(p),
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
  const available=new Set(archiveDates);
  for(const [daysText,backtrack] of Object.entries(COMPARISON_WINDOWS)){
    const days=Number(daysText);
    for(let step=days;step<=days+backtrack;step++){
      const date=shiftSurveyDate(surveyDate,-step);
      if(available.has(date))needed.add(date);
    }
  }
  return [...needed].sort((a,b)=>b.localeCompare(a));
}

export function shiftSurveyDate(iso,deltaDays) {
  if(!isValidISODate(iso))throw Error('FAMA 调查日期无效');
  const instant=Date.parse(iso+'T12:00:00Z');
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
    days.set(day,marketGroups(canonical));
    if(day!==surveyDate)continue;
    latestRows=canonical.length;
    for(const row of canonical){
      const price=validPrice(row.harga),level=String(row.peringkat||'').trim(),
        variety=String(row.varieti||'').trim();
      if(price===null||!PRICE_LEVELS.includes(level)||!variety)continue;
      validLatestRows++;
      const product=productIdentity(row);
      const state=String(row.negeri||'').trim();
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

  const scopedMarkets=(day,level,product,state)=>marketsInScope(days.get(day)?.get(level)?.get(product),state);
  const compare=(group,period)=>{
    const current=scopedMarkets(surveyDate,group.level,group.product,group.state);
    if(!current?.size)return null;
    const target=shiftSurveyDate(surveyDate,-period);
    const earliest=shiftSurveyDate(target,-COMPARISON_WINDOWS[period]);
    for(const previousDate of needed){
      if(previousDate>target||previousDate<earliest)continue;
      const previous=scopedMarkets(previousDate,group.level,group.product,group.state);
      const result=matchedMarketStats(current,previous);
      if(result)return {...result,currentDate:surveyDate,previousDate,days:period,
        actualDays:ageDays(previousDate,surveyDate)};
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
      date:surveyDate,price:marketMean(markets),
      observations:group.rows.length,markets:markets.size,
      ...([...markets.values()].some(bucket=>bucket.review)?{priceReview:true}:{}),
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

export function parseCSV(input,expectedDate) {
  const text=String(input??'').replace(/^\uFEFF/,'');
  const output=[];
  let positions=null,cells=[],field='',mode='plain',record=1;
  const fail=message=>{throw Error('FAMA CSV 第 '+record+' 条记录：'+message);};
  const finish=()=>{
    if(!cells.length&&!field&&mode==='plain')return;
    cells.push(field);
    if(positions===null){
      const headers=cells.map(v=>v.trim().toLowerCase());
      if(headers.length!==FAMA_COLUMNS.length||FAMA_COLUMNS.some(name=>!headers.includes(name)))
        fail('缺少必需字段、字段重复或列数不符。');
      positions=FAMA_COLUMNS.map(name=>headers.indexOf(name));
    }else{
      if(cells.length!==FAMA_COLUMNS.length)fail('列数不符。');
      const item=Object.fromEntries(FAMA_COLUMNS.map((name,i)=>[name,cells[positions[i]]]));
      if(!isValidISODate(item.tarikh_harga)||(expectedDate&&item.tarikh_harga!==expectedDate))
        fail('调查日期无效或与档案日期不一致。');
      output.push(item);
    }
    cells=[];
    field='';
    mode='plain';
    record++;
  };
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(mode==='quoted'){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')mode='closed';
      else field+=ch;
    }else if(ch===','){
      cells.push(field);field='';mode='plain';
    }else if(ch==='\r'||ch==='\n'){
      finish();
      if(ch==='\r'&&text[i+1]==='\n')i++;
    }else if(mode==='closed'||(ch==='"'&&field)){
      fail('引号位置无效。');
    }else if(ch==='"')mode='quoted';
    else field+=ch;
  }
  if(mode==='quoted')fail('引号未正确闭合。');
  finish();
  if(positions===null)fail('缺少必需字段。');
  return output;
}

export function validPrice(value) {
  const text=String(value??'').trim();
  if(!DECIMAL_PRICE.test(text))return null;
  const number=Number(text);
  return Number.isFinite(number)&&number>=0 ? number : null;
}

export function summarizeRows(rows, supersededByDate = {}) {
  const days=new Map();
  for(const row of rows){
    if(!isValidISODate(row.tarikh_harga))continue;
    if(!days.has(row.tarikh_harga))days.set(row.tarikh_harga,[]);
    days.get(row.tarikh_harga).push(row);
  }
  const groups = new Map();
  for(const [date,raw] of days){
    for(const r of canonicalDailyRows(raw,supersededByDate[date]||[])){
      const price=validPrice(r.harga),level=String(r.peringkat??'').trim();
      const state=String(r.negeri??'').trim();
      if(price===null||!String(r.varieti??'').trim()||!PRICE_LEVELS.includes(level))continue;
      const groupKey=JSON.stringify([date,productIdentity(r),level,state]);
      if(!groups.has(groupKey))groups.set(groupKey,{r,level,state,markets:new Map()});
      addMarket(groups.get(groupKey).markets,r,price);
    }
  }
  const output=[];
  for(const {r,level,state,markets} of groups.values()){
    output.push({
      date:r.tarikh_harga,varieti:r.varieti,gred:r.gred,unit:r.unit,
      level,state,price:marketMean(markets),
      markets:markets.size,observations:[...markets.values()].reduce((n,m)=>n+m.count,0),
      category:r.kategori,
      ...([...markets.values()].some(bucket=>bucket.review)?{priceReview:true}:{})
    });
  }
  return output.sort((a,b)=>a.date.localeCompare(b.date)||a.state.localeCompare(b.state)||a.varieti.localeCompare(b.varieti));
}
