import {FAMA_COLUMNS,escapeHtml,fmtMoney,fmtDate,ageDays,mytDate,quoteChange,
  rankMovers,dailyStorySignals,filterQuotes,sortQuotesByChange,groupQuotesByProduct,productLabel,historySeries,statePrices,parseCSV,
  archiveComparisonDates,buildPriceDateSnapshot,shiftSurveyDate,
  validPrice,summarizeRows,PRICE_LEVELS,canonicalDailyRows,productAreaRows,productScopePrices,
  comparisonEvidence,comparisonMarketDetails,matchedMarketStreaks,
  productAreaOptions} from './engine.mjs';
import {buildXlsx,downloadXlsx} from './excel.mjs';
import {createCreatorWorkspace} from './creator-app.mjs';
import {buildMarketPostIdea,evidenceForQuote,formatPercent,formatPrice} from './creator-core.mjs';
import {buildFamaPdf,downloadPdf} from '../pdf.mjs';

const $=id=>document.getElementById(id);
const BASE='../data/v3/';
const RAW_BASE='https://raw.githubusercontent.com/Luke2929/bg-agro-price-tracker/master/data/daily/';
const ARCHIVE_API='https://api.github.com/repos/Luke2929/bg-agro-price-tracker/contents/data/daily/';
const PAGE_NAMES={overview:'农价总览',prices:'价格明细',history:'历史与州别',watchlist:'我的关注',signals:'选题情报',studio:'内容工作室',calendar:'内容日历与成效',export:'Excel / PDF 导出',system:'运行状态',product:'农产品详情'};
const store={overview:null,index:null,meta:null,health:null,history:new Map(),page:'overview',
  period:1,visible:40,watch:[],fetching:false,rawCache:new Map(),dailyPending:new Map(),
  insightData:null,insightRequest:0,snapshots:new Map(),streaks:new Map(),comparison:null,comparisonRequest:0,
  priceData:null,priceDateRequest:0,
  detail:{key:null,origin:'prices',rawRows:null,rawError:'',visible:80,rawRequest:0,historyRequest:0}};
let historyRequestSequence=0;
const creator=createCreatorWorkspace({getOverview:()=>store.overview,
  getArchiveDates:()=>store.meta.archive_dates,loadSnapshot,loadEvidenceRows,
  loadHistory,loadStreaks,showComparison,notify:alertUser,navigate});
const LEVEL_MEANINGS={Ladang:'农场端 · Farm-gate price',Borong:'批发端 · Wholesale price',
  Runcit:'零售端 · Consumer retail price'};
const verifiedInsightButtons=new WeakSet();

function levelBadge(level){
  return `<span class="price-level-pill price-level-${escapeHtml(level.toLowerCase())}" title="${LEVEL_MEANINGS[level]}">${escapeHtml(level)}</span>`;
}

async function fetchJson(path,refresh=false){
  const response=await fetch(path+(refresh?(path.includes('?')?'&':'?')+'t='+Date.now():''),
    {cache:refresh?'no-store':'default'});
  if(!response.ok)throw Error(`数据读取失败 (${response.status})：${path}`);
  return response.json();
}

function alertUser(message,error=false){
  const toast=$('toast');toast.textContent=message;toast.hidden=false;
  toast.style.background=error?'#9b5040':'#204d61';
  clearTimeout(alertUser.timer);alertUser.timer=setTimeout(()=>toast.hidden=true,5200);
}
function failure(message){$('error-banner').textContent=message;$('error-banner').hidden=false;alertUser(message,true);}

function selectOptions(element,items,{initialLabel,defaultValue=''}={}){
  const existing=element.value;
  element.replaceChildren();
  if(initialLabel!==undefined)element.add(new Option(initialLabel,''));
  for(const item of items){
    const value=typeof item==='string'?item:item.value;
    const label=typeof item==='string'?item:item.label;
    element.add(new Option(label,value));
  }
  if([...element.options].some(option=>option.value===existing))element.value=existing;
  else element.value=[...element.options].some(o=>o.value===defaultValue)?defaultValue:'';
}

function navigate(page){
  if(!PAGE_NAMES[page])return;
  store.page=page;
  document.querySelectorAll('[data-screen]').forEach(el=>el.classList.toggle('active',el.dataset.screen===page));
  document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('selected',el.dataset.page===page));
  $('trail').textContent=PAGE_NAMES[page];
  if(page==='history')renderHistory().catch(e=>failure(e.message));
  if(page==='watchlist')renderWatchlist();
  if(page==='export')renderExportDates();
  if(page==='system'){renderHealth();loadGitHubRunHealth();}
  if(page==='product'&&store.detail.key)renderProductDetail();
  if(['signals','studio','calendar'].includes(page))creator.render(page);
  window.scrollTo({top:0,behavior:'instant'});
}

function percentMarkup(quote,period,detailsIndex){
  const c=comparisonEvidence(quote,period);
  if(!c)return '<span class="delta-empty" title="未达到同市场样本门槛，或缺少可比调查日">不可比</span>';
  const cls=c.percent>0?'delta-positive':c.percent<0?'delta-negative':'';
  const tooltip=`${c.previousDate} → ${c.currentDate} · 实际 ${c.actualDays} 天 · ${c.markets} 个共同市场`;
  const value=formatPercent(c.percent);
  const markup=detailsIndex===undefined?`<span class="${cls}">${value}</span>`:
    `<button type="button" class="comparison-link ${cls}" data-price-details="${detailsIndex}" data-comparison-period="${period}" aria-label="${escapeHtml(quote.varieti+' '+quote.level+' '+value+' 查看价格对比依据')}">${value}</button>`;
  return `<div class="comparison-cell" title="${tooltip}">${markup}<small>${c.previousDate} → ${c.currentDate}<br>${c.actualDays} 天 · ${c.markets} 市场</small></div>`;
}

function watchId(quote){return [quote.product_key,quote.level,quote.state].join('\u001E');}
function isSaved(quote){return store.watch.includes(watchId(quote));}
function writeWatch(){
  try{localStorage.setItem('bg-agro-v3-watch-v1',JSON.stringify(store.watch));}
  catch(_){alertUser('浏览器无法保存关注项；此页关闭后可能丢失。',true);}
  $('saved-counter').textContent=String(store.watch.length);
}
function readWatch(){
  try{
    const value=JSON.parse(localStorage.getItem('bg-agro-v3-watch-v1')||'[]');
    if(Array.isArray(value))store.watch=value.filter(x=>typeof x==='string'&&x.length<400).slice(0,20);
  }catch(_){store.watch=[];}
  $('saved-counter').textContent=String(store.watch.length);
}
function toggleSaved(quote){
  const id=watchId(quote),index=store.watch.indexOf(id);
  if(index>=0)store.watch.splice(index,1);
  else if(store.watch.length<20)store.watch.push(id);
  else{alertUser('关注上限为 20 项，请先删除旧项目。',true);return;}
  writeWatch();renderPrices();renderWatchlist();
}

function renderSummary(){
  const data=store.overview;
  const age=ageDays(data.survey_date,mytDate());
  $('source-badge').textContent=age===null?'调查日期不明':age===0?'● 今日已调查':`● 最新调查 ${age} 天前`;
  $('source-badge').className='tag'+(age>2?' warning':'');
  $('stat-survey').textContent=fmtDate(data.survey_date);
  $('stat-age').textContent=age===0?'马来西亚今日已有价格记录':age>0?`距离今日 ${age} 天 · 不冒充今日价格`:'来源价格调查日';
  $('stat-rows').textContent=Number(data.valid_latest_rows).toLocaleString('en-MY');
  $('stat-states').textContent=data.states.length+' / 16';
  $('stat-quotes').textContent=data.prices.length.toLocaleString('en-MY');
  renderMovers();renderDailyInsights();
  const shortlist=data.prices.filter(p=>!p.state&&p.level==='Borong').slice(0,8);
  $('quick-prices').innerHTML=shortlist.length?shortlist.map(p=>
    `<div class="quick-item"><button type="button" class="product-link" data-product-open="${escapeHtml(p.product_key)}" title="${escapeHtml(productLabel(p))}">${escapeHtml(p.varieti)} ↗</button><span>${fmtMoney(p.price)}</span><small>${escapeHtml(p.gred||'未分级')} · ${escapeHtml(p.unit)} · ${p.markets} 个市场</small></div>`
  ).join(''):'<p class="empty">暂无批发层级调查记录。</p>';
}

function comparisonSummary(c){
  return `<div class="comparison-prices">
    <div><small>${c.previousDate}</small><strong>${escapeHtml(formatPrice(c.previousMean,c.unit))}</strong></div>
    <div><small>${c.currentDate}</small><strong>${escapeHtml(formatPrice(c.currentMean,c.unit))}</strong></div>
    <div><small>价差</small><strong>${escapeHtml(formatPrice(c.rmDifference,c.unit,{signed:true}))}</strong></div>
  </div><p class="insight-statline">实际 ${c.actualDays} 天 · ${c.markets} 个共同市场</p>`;
}

async function verifyInsightCopy(button,evidence){
  try{
    const {rows,superseded}=await loadEvidenceRows(evidence);
    comparisonMarketDetails(rows,evidence,superseded);
    if(button.isConnected){
      verifiedInsightButtons.add(button);
      button.disabled=false;
      button.title='';
    }
  }catch(error){
    if(button.isConnected){
      button.title=error.message;
      const status=document.createElement('p');
      status.className='insight-statline';
      status.setAttribute('role','status');
      status.textContent='价格数据验证失败。'+error.message;
      button.parentElement.before(status);
    }
  }
}

function renderDailyInsights(){
  const data=store.insightData;
  if(!data)return;
  const period=store.period,day=data.survey_date;
  const analysis=dailyStorySignals(data.prices,period);
  $('insight-date').textContent=(day===store.overview.survey_date?'最新调查 · ':'历史调查 · ')+day;
  document.querySelectorAll('[data-insight-period]').forEach(btn=>{
    const active=Number(btn.dataset.insightPeriod)===period;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-pressed',String(active));
  });
  const periodName=period===1?'昨日窗口':period+' 天窗口';
  for(const [direction,id,label] of [
    ['rise','insight-rise','涨幅焦点'],['fall','insight-fall','跌幅焦点']
  ]){
    const quote=analysis[direction];
    const c=evidenceForQuote(quote,period,data.prices,day);
    if(!c){
      $(id).innerHTML=`<div class="insight-story-top"><span class="insight-story-kicker">${label}</span><span class="insight-scope">${periodName}</span></div><h2>暂无可比${direction==='rise'?'上涨':'下跌'}报价</h2><p class="insight-empty-copy">可切换调查日或比较周期。</p>`;
      continue;
    }
    $(id).innerHTML=`<div class="insight-story-top"><span class="insight-story-kicker">${label} · ${periodName}</span><span class="insight-scope">全国调查样本 · ${levelBadge(c.level)}</span></div>
      <h2>${escapeHtml(c.product)}</h2>
      <p class="insight-statline">${escapeHtml(c.grade||'未记录品级')} · ${escapeHtml(c.unit)}</p>
      <div class="insight-metric"><strong>${formatPercent(c.percent)}</strong></div>
      ${comparisonSummary(c)}
      ${c.publishable?'':'<p class="insight-statline">同产品其他层级有大幅波动，文案待核实。</p>'}
      <div class="insight-story-actions">
        <button type="button" data-insight-details="${direction}">查看价格对比依据</button>
        <button type="button" data-insight-copy="${direction}" disabled${c.publishable?' title="正在核对原始市场报价"':''}>复制马来文选题</button>
        <button type="button" data-insight-studio="${direction}"${c.publishable?'':' disabled'}>写这条选题</button>
        <button type="button" data-insight-view="${direction}">查看涨跌榜 →</button>
      </div>`;
    if(c.publishable)verifyInsightCopy($(id).querySelector('[data-insight-copy]'),c);
  }
  if(analysis.aligned){
    const item=analysis.aligned;
    const rows=item.levels.map(q=>comparisonEvidence(q,period,day)).filter(Boolean).map(c=>
      `<li>${levelBadge(c.level)} <b>${formatPercent(c.percent)}</b> · ${escapeHtml(formatPrice(c.previousMean,c.unit)+' → '+formatPrice(c.currentMean,c.unit)+' · '+formatPrice(c.rmDifference,c.unit,{signed:true}))}<small>${c.previousDate} → ${c.currentDate} · ${c.actualDays} 天 · ${c.markets} 市场</small><button type="button" class="text-button" data-insight-details="aligned" data-comparison-level="${c.level}">查看价格对比依据</button></li>`).join('');
    $('insight-aligned').innerHTML=`<span class="insight-aux-label">三个层级同向变化 · 全国调查样本</span><strong>${escapeHtml(item.varieti)} · ${escapeHtml(item.levels[0].gred||'未记录品级')} · ${escapeHtml(item.levels[0].unit)}</strong><ul class="insight-comparison-list">${rows}</ul>`;
  }else{
    $('insight-aligned').innerHTML='<span class="insight-aux-label">三个层级同向变化</span><strong>该周期暂无三层同向的合格样本</strong>';
  }
  const extreme=comparisonEvidence(analysis.extreme,period,day);
  if(extreme){
    $('insight-warning').innerHTML=`<span class="insight-aux-label">需要核实的大幅波动 · 全国调查样本</span><strong>${escapeHtml(extreme.product)} · ${escapeHtml(extreme.grade||'未记录品级')} · ${levelBadge(extreme.level)} ${formatPercent(extreme.percent)}</strong>
      ${comparisonSummary(extreme)}
      <p>绝对涨跌达到 50%。${analysis.extremeCount>1?'另有 '+(analysis.extremeCount-1)+' 组波动待核实。':''}</p><button type="button" class="text-button" data-insight-details="extreme">查看价格对比依据</button>`;
  }else{
    $('insight-warning').innerHTML='<span class="insight-aux-label">大幅波动</span><strong>当前周期无达到 50% 的可比波动</strong>';
  }
  $('insight-method').textContent='全国调查样本 · '+analysis.comparableCount+' 组可比报价 · 至少 3 个共同市场且两日覆盖率各 ≥ 50%。';
}

async function loadInsightDate(){
  const day=$('insight-survey-date').value,request=++store.insightRequest;
  store.insightData=null;
  $('insight-date').textContent=day+' · 正在核对调查记录…';
  $('insight-method').textContent='';
  for(const id of ['insight-rise','insight-fall','insight-aligned','insight-warning'])$(id).replaceChildren();
  renderMovers();
  try{
    const data=await loadSnapshot(day);
    if(request!==store.insightRequest)return;
    store.insightData=data;
    renderMovers();renderDailyInsights();
  }catch(error){
    if(request===store.insightRequest)$('insight-date').textContent=day+' 的调查比较无法读取：'+error.message;
  }
}

function renderMovers(){
  const data=store.insightData;
  document.querySelectorAll('[data-period]').forEach(btn=>btn.classList.toggle('active',Number(btn.dataset.period)===store.period));
  for(const direction of ['up','down']){
    const list=data?rankMovers(data.prices,store.period,direction):[];
    $(direction==='up'?'movers-up':'movers-down').innerHTML=list.length?list.map(p=>
      `<div class="mover"><div style="min-width:0"><strong title="${escapeHtml(productLabel(p))}">${escapeHtml(p.varieti)}</strong><small>${levelBadge(p.level)} · ${p.change.markets} 个共同市场</small><small>${p.change.previousDate} → ${p.change.currentDate} · 实际 ${p.change.actualDays} 天</small></div><b class="${direction==='up'?'positive':'negative'}">${formatPercent(p.change.percent)}</b></div>`
    ).join(''):'<p class="empty">这一观察窗口暂无符合样本门槛的可比涨跌。</p>';
  }
}

function filters(){return {search:$('price-search').value,level:$('price-level').value,
  state:$('price-state').value,category:$('price-category').value};}
function priceLevelCells(quote){
  const id=store.priceData.prices.indexOf(quote);
  return `<td>${levelBadge(quote.level)}</td><td>${escapeHtml(quote.state||'全马')}</td><td class="price-cell">${fmtMoney(quote.price)}</td><td>${percentMarkup(quote,1,id)}</td><td>${percentMarkup(quote,7,id)}</td><td>${percentMarkup(quote,30,id)}</td><td>${quote.markets}<small>${quote.observations} 条记录</small></td><td><button class="star ${isSaved(quote)?'saved':''}" data-watch-index="${id}" aria-label="${isSaved(quote)?'取消关注':'加入关注'}：${escapeHtml(quote.varieti)} ${escapeHtml(quote.level)}">${isSaved(quote)?'★':'☆'}</button></td>`;
}

function priceProductCell(quote,rowspan=1,leader=null,period=7,order='name'){
  const rank=leader&&order!=='name'?quoteChange(leader,period):null;
  const rankLabel=rank?`${escapeHtml(leader.level)} ${rank.percent>0?'+':''}${rank.percent.toFixed(1)}%`:'';
  const descriptor=escapeHtml([quote.gred,quote.unit].filter(Boolean).join(' · '));
  return `<td class="price-product-cell"${rowspan>1?` rowspan="${rowspan}"`:''}><button type="button" class="product-link" data-product-open="${escapeHtml(quote.product_key)}" title="${store.priceData.survey_date!==store.overview.survey_date?'产品详情显示最新调查日，而非本页所选历史日期':'打开产品详情'}">${escapeHtml(quote.varieti)} ↗</button><small>${descriptor}</small>${rank?`<small class="price-rank-note">排序依据 · ${period} 天 · ${rankLabel}</small>`:''}</td>`;
}

function renderPrices(){
  if(!store.priceData)return;
  const period=Number($('price-change-period').value);
  const order=$('price-change-order').value;
  const mode=$('price-display-mode').value;
  const filtered=filterQuotes(store.priceData.prices,filters());
  const matches=sortQuotesByChange(filtered,{period,order});
  const grouped=mode==='group';
  const groups=grouped?groupQuotesByProduct(filtered,{period,order}):[];
  const visible=grouped?groups.slice(0,store.visible):matches.slice(0,store.visible);
  const sortLabels={name:'按产品名称',rise:'涨幅最大优先',fall:'跌幅最大优先',swing:'绝对波动最大优先'};
  const prefix=fmtDate(store.priceData.survey_date)+' · ';
  const criteria=order==='name'?sortLabels.name:period+' 天'+sortLabels[order];
  $('price-table-status').textContent=prefix+
    (grouped?`${groups.length} 种产品 · ${groups.reduce((n,g)=>n+g.quotes.length,0)} 组层级报价`:`${matches.length} 组层级报价`)+
    ' · '+criteria;
  document.querySelectorAll('[data-price-period]').forEach(btn=>{
    const active=Number(btn.dataset.pricePeriod)===period&&order!=='name';
    btn.classList.toggle('active',active);
    btn.querySelector('.sort-arrow').textContent=active?(order==='rise'?'↑':order==='fall'?'↓':'↕'):'↕';
    btn.closest('th').setAttribute('aria-sort',active?(order==='rise'?'descending':order==='fall'?'ascending':'other'):'none');
  });
  if(grouped){
    const rows=[];
    for(const group of visible){
      group.quotes.forEach((quote,index)=>{
        const labelCell=index===0?priceProductCell(
          group.quotes[0],group.quotes.length,group.leader,period,order
        ):'';
        const selected=group.leader===quote?' price-sort-leading-level':'';
        const rowClass=(index===0?'price-group-first':'price-group-follow')+selected;
        rows.push(`<tr class="${rowClass}">${labelCell}${priceLevelCells(quote)}</tr>`);
      });
    }
    $('price-table-body').innerHTML=rows.join('')||
      '<tr><td colspan="9" class="empty">当前条件没有符合涨跌方向的产品，请更换比较周期或选择「产品名称」。</td></tr>';
    const quoteCount=visible.reduce((n,g)=>n+g.quotes.length,0);
    $('price-visible').textContent=`显示 ${visible.length} / ${groups.length} 种产品 · ${quoteCount} 组独立层级报价`;
    $('more-prices').disabled=groups.length<=store.visible;
  }else{
    $('price-table-body').innerHTML=visible.map(quote=>
      `<tr>${priceProductCell(quote)}${priceLevelCells(quote)}</tr>`
    ).join('')||'<tr><td colspan="9" class="empty">当前筛选／涨跌排序没有符合条件的可比报价，请换一个周期或选择「产品名称」。</td></tr>';
    $('price-visible').textContent=`显示 ${visible.length} / ${matches.length} 组独立层级报价`;
    $('more-prices').disabled=matches.length<=store.visible;
  }
}

async function loadPriceDate(){
  if(!store.meta||!store.overview)return;
  const selected=$('price-date').value;
  const sequence=++store.priceDateRequest;
  store.visible=40;
  store.priceData=null;
  $('price-table-body').innerHTML='<tr><td colspan="9" class="empty">正在读取所选调查日及真实历史基准…</td></tr>';
  $('price-table-status').textContent=selected+' · 正在计算市场涨跌…';
  $('price-visible').textContent='等待历史数据';
  $('more-prices').disabled=true;
  $('price-date-latest').disabled=selected===store.overview.survey_date;
  const status=$('price-date-status');
  if(!store.meta.archive_dates.includes(selected)){
    status.textContent='请从已归档的 FAMA 调查日期中选择，不能填写不存在的报价日期。';
    $('price-table-status').textContent='日期不在档案中';
    return;
  }
  try{
    const snapshot=await loadSnapshot(selected);
    if(sequence!==store.priceDateRequest)return;
    store.priceData=snapshot;
    selectOptions($('price-state'),snapshot.states,{initialLabel:'全马平均'});
    selectOptions($('price-category'),
      [...new Set(snapshot.prices.map(p=>p.kategori).filter(Boolean))].sort(),
      {initialLabel:'全部分类'});
    const targets=[1,7,30].map(n=>`${n} 天：${shiftSurveyDate(selected,-n)}`).join(' · ');
    status.textContent=`当前调查日 ${selected} · 目标日期 ${targets}。各列显示实际对比日期，点击涨跌幅可核对逐市场均价。`;
    renderPrices();
  }catch(error){
    if(sequence!==store.priceDateRequest)return;
    store.priceData=null;
    status.textContent=`${selected} 历史价格计算失败：${error.message}。没有使用其他日期冒充所选日期。`;
    $('price-table-status').textContent=selected+' · 读取失败';
    $('price-table-body').innerHTML='<tr><td colspan="9" class="empty">原始 CSV 未能全部验证，当前不显示未经确认的价格。请重选日期或刷新。</td></tr>';
    $('price-visible').textContent='无可显示数据';
    alertUser('历史数据读取失败：'+error.message,true);
  }
}

async function loadDaily(date){
  if(store.rawCache.has(date))return store.rawCache.get(date);
  if(store.dailyPending.has(date))return store.dailyPending.get(date);
  const pending=(async()=>{
    const version=store.meta.archive_versions?.[date];
    const revision=version||store.meta.generated_at_utc||'';
    const file=encodeURIComponent(date)+'.csv';
    async function fetchArchive(url,headers){
      const response=await fetch(url,{headers,signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();
      if(version&&globalThis.crypto?.subtle){
        const hash=await crypto.subtle.digest('SHA-256',bytes);
        const actual=[...new Uint8Array(hash)].slice(0,8).map(x=>x.toString(16).padStart(2,'0')).join('');
        if(actual!==version)throw Error('CSV 与当前档案版本不一致。请刷新后重试。');
      }
      const rows=parseCSV(new TextDecoder('utf-8',{fatal:true}).decode(bytes),date);
      if(!rows.length)throw Error('CSV 没有调查记录。');
      return rows;
    }
    let rows;
    try{
      rows=await fetchArchive(RAW_BASE+file+(revision?'?rev='+encodeURIComponent(revision):''));
    }catch(primary){
      try{
        rows=await fetchArchive(ARCHIVE_API+file+'?ref=master'+(revision?'&rev='+encodeURIComponent(revision):''),
          {Accept:'application/vnd.github.raw+json'});
      }catch(fallback){
        throw Error(date+' 原始档案读取失败。'+primary.message+' / '+fallback.message);
      }
    }
    if(store.dailyPending.get(date)===pending)store.rawCache.set(date,rows);
    return rows;
  })();
  store.dailyPending.set(date,pending);
  try{return await pending;}
  finally{if(store.dailyPending.get(date)===pending)store.dailyPending.delete(date);}
}

async function loadSnapshot(selected){
  if(selected===store.overview.survey_date)return store.overview;
  const {archive_dates,superseded_priceids}=store.meta;
  const required=archiveComparisonDates(archive_dates,selected);
  if(!required.length)throw Error('选中的调查日期不在档案中。');
  if(store.snapshots.has(selected))return store.snapshots.get(selected);
  const pending=(async()=>{
    const archive=new Map();
    for(let i=0;i<required.length;i+=4){
      const batch=required.slice(i,i+4);
      const fetched=await Promise.all(batch.map(loadDaily));
      batch.forEach((day,index)=>archive.set(day,fetched[index]));
    }
    return buildPriceDateSnapshot(archive,{
      surveyDate:selected,archiveDates:archive_dates,supersededByDate:superseded_priceids||{}
    });
  })();
  store.snapshots.set(selected,pending);
  try{return await pending;}
  catch(error){
    if(store.snapshots.get(selected)===pending)store.snapshots.delete(selected);
    throw error;
  }
}

async function loadEvidenceRows(evidence){
  const superseded=store.meta.superseded_priceids||{};
  const dates=[evidence.previousDate,evidence.currentDate];
  const daily=await Promise.all(dates.map(loadDaily));
  return {rows:new Map(dates.map((day,index)=>[day,daily[index]])),superseded};
}

async function loadStreaks(day,state){
  const key=JSON.stringify([day,state]);
  if(store.streaks.has(key))return store.streaks.get(key);
  const dates=store.meta.archive_dates.filter(date=>date<=day).slice(-3);
  const supersededByDate=store.meta.superseded_priceids||{};
  const pending=Promise.all(dates.map(loadDaily)).then(daily=>
    matchedMarketStreaks(new Map(dates.map((date,index)=>[date,daily[index]])),{state,supersededByDate}));
  store.streaks.set(key,pending);
  try{return await pending;}
  catch(error){
    if(store.streaks.get(key)===pending)store.streaks.delete(key);
    throw error;
  }
}

const marketName=(a,b)=>a.location.localeCompare(b.location)||a.district.localeCompare(b.district)||
  a.state.localeCompare(b.state)||a.sublevel.localeCompare(b.sublevel);
const marketSort={
  rise:(a,b)=>(b.percent??-Infinity)-(a.percent??-Infinity)||marketName(a,b),
  fall:(a,b)=>(a.percent??Infinity)-(b.percent??Infinity)||marketName(a,b),
  location:marketName,state:(a,b)=>a.state.localeCompare(b.state)||marketName(a,b),
  difference:(a,b)=>Math.abs(b.difference)-Math.abs(a.difference)||marketName(a,b)
};

function renderComparisonRows(){
  if(!store.comparison)return;
  const {evidence:c,details}=store.comparison;
  const sort=marketSort[$('comparison-sort').value]||marketSort.rise;
  $('comparison-body').innerHTML=[...details].sort(sort).map(m=>{
    const values=[m.state,m.district,m.location,c.level,m.sublevel,c.previousDate,
      formatPrice(m.previousMean,c.unit,{precision:4}),m.previousObservations,c.currentDate,
      formatPrice(m.currentMean,c.unit,{precision:4}),m.currentObservations,
      formatPrice(m.difference,c.unit,{signed:true,precision:4}),formatPercent(m.percent)];
    return '<tr>'+values.map(value=>'<td>'+escapeHtml(value===''?'—':value)+'</td>').join('')+'</tr>';
  }).join('');
}

async function showComparison(evidence){
  const dialog=$('comparison-dialog'),request=++store.comparisonRequest;
  store.comparison=null;
  $('comparison-selection').textContent=[evidence.product,evidence.grade||'未记录品级',evidence.unit,
    evidence.level,evidence.region||'全国调查样本'].join(' · ');
  $('comparison-status').textContent='正在读取两天的原始市场报价并对账…';
  $('comparison-result').hidden=true;
  if(!dialog.open)dialog.showModal();
  try{
    const {rows,superseded}=await loadEvidenceRows(evidence);
    const result=comparisonMarketDetails(rows,evidence,superseded);
    if(request!==store.comparisonRequest||!dialog.open)return;
    store.comparison={evidence,details:result.details};
    $('comparison-status').textContent='已与 '+result.markets+' 个共同市场对账。';
    $('comparison-reconciliation').textContent=
      evidence.previousDate+' '+formatPrice(result.previous,evidence.unit,{precision:4})+
      ' → '+evidence.currentDate+' '+formatPrice(result.current,evidence.unit,{precision:4})+
      ' · 实际 '+evidence.actualDays+' 天 · 价差 '+formatPrice(result.rmDifference,evidence.unit,{signed:true,precision:4})+
      ' · '+formatPercent(result.percent)+' · 两日覆盖 '+result.markets+'/'+result.previousMarkets+
      ' 和 '+result.markets+'/'+result.currentMarkets+' 个市场。';
    $('comparison-sort').value='rise';
    renderComparisonRows();
    $('comparison-result').hidden=false;
  }catch(error){
    if(request===store.comparisonRequest&&dialog.open)
      $('comparison-status').textContent='价格对账失败：'+error.message;
  }
}

function renderMarketRows(){
  const date=$('market-date').value,rows=store.rawCache.get(date);
  if(!rows)return;
  const state=$('market-state').value,place=$('market-search').value.trim().toLocaleUpperCase(),
    product=$('market-product').value.trim().toLocaleUpperCase();
  const matching=canonicalDailyRows(rows,store.meta.superseded_priceids?.[date]||[]).filter(r=>(!state||r.negeri===state)&&
    (!place||[r.daerah,r.lokasi].some(v=>v.toLocaleUpperCase().includes(place)))&&
    (!product||[r.varieti,r.gred].some(v=>v.toLocaleUpperCase().includes(product))));
  const visible=matching.slice(0,80);
  $('market-status').textContent=`${date} · ${matching.length} 条市场采集记录（展示前 ${visible.length} 条；包含空价格）`;
  $('market-body').innerHTML=visible.map(r=>
    `<tr><td>${escapeHtml(r.tarikh_harga)}</td><td>${escapeHtml(r.negeri)}</td><td>${escapeHtml(r.daerah)}</td><td>${escapeHtml(r.lokasi)}</td><td><strong>${escapeHtml(r.varieti)}</strong><small>${escapeHtml(r.gred)} · ${escapeHtml(r.unit)}</small></td><td>${escapeHtml(r.peringkat)}</td><td class="price-cell">${validPrice(r.harga)===null?'—':fmtMoney(validPrice(r.harga))}</td></tr>`
  ).join('')||'<tr><td colspan="7" class="empty">指定日期及地区没有有效 FAMA 采集记录。</td></tr>';
}

async function loadMarkets(){
  const date=$('market-date').value;
  if(!store.meta?.archive_dates?.includes(date))return alertUser('请从真实调查日期中选择。',true);
  $('market-status').textContent=`正在读取 ${date} 的原始 CSV…`;
  $('fetch-markets').disabled=true;
  try{await loadDaily(date);renderMarketRows();}
  catch(e){$('market-status').textContent='读取失败：'+e.message;alertUser(e.message,true);}
  finally{$('fetch-markets').disabled=false;}
}

function renderWatchlist(){
  if(!store.overview)return;
  const quotes=new Map(store.overview.prices.map(q=>[watchId(q),q]));
  $('watch-body').innerHTML=store.watch.map((id,index)=>{
    const q=quotes.get(id);
    if(!q)return `<tr><td colspan="7">此项目在最新调查日没有报价；不会用旧价填充。</td><td><button class="text-button" data-watch-remove="${index}">移除</button></td></tr>`;
    return `<tr><td><button type="button" class="product-link" data-product-open="${escapeHtml(q.product_key)}">${escapeHtml(q.varieti)} ↗</button><small>${escapeHtml([q.gred,q.unit].filter(Boolean).join(' · '))}</small></td><td>${escapeHtml(q.level)}</td><td>${escapeHtml(q.state||'全马')}</td><td class="price-cell">${fmtMoney(q.price)}</td><td>${percentMarkup(q,1)}</td><td>${percentMarkup(q,7)}</td><td>${percentMarkup(q,30)}</td><td><button class="text-button" data-watch-remove="${index}">移除</button></td></tr>`;
  }).join('')||'<tr><td colspan="8" class="empty">还没有关注的农产品。到「价格明细」点击 ☆ 即可保存。</td></tr>';
}

async function loadHistory(productKey){
  if(store.history.has(productKey))return store.history.get(productKey);
  const entry=store.index.products.find(p=>p.product_key===productKey);
  if(!entry || !/^history\/[0-9a-f]{20}\.json$/.test(entry.path))throw Error('找不到对应产品的历史数据');
  const history=await fetchJson(BASE+entry.path+'?revision='+encodeURIComponent(store.overview.generated_at_utc));
  if(history.schema!=='bg-agro/fama-history/v3'||history.product_key!==productKey||!Array.isArray(history.observations))
    throw Error('历史数据格式或产品键不匹配');
  store.history.set(productKey,history);
  return history;
}

function drawChart(points,start,end,svg=$('history-chart')){
  const x0=54,y0=22,plotHeight=204,plotBottom=y0+plotHeight;
  const dayCount=Math.max(1,Math.round((Date.parse(end)-Date.parse(start))/86400000)+1);
  const width=Math.max(700,dayCount*8+84),plotWidth=width-x0-25;
  const max=Math.max(1,...points.map(p=>p.price)),upper=Math.ceil(max*1.12*10)/10;
  svg.setAttribute('viewBox',`0 0 ${width} 280`);svg.style.width=width+'px';
  const grids=Array.from({length:5},(_,i)=>{
    const val=upper*i/4,y=plotBottom-(val/upper)*plotHeight;
    return `<line x1="${x0}" x2="${width-12}" y1="${y}" y2="${y}" stroke="#e4eee6"/><text x="${x0-9}" y="${y+3}" text-anchor="end" font-size="10" fill="#8fa599">${val.toFixed(1)}</text>`;
  }).join('');
  const bars=points.map(p=>{
    const day=Math.round((Date.parse(p.date+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000);
    const x=x0+(day+.5)/dayCount*plotWidth;
    const height=p.price/upper*plotHeight;
    const barWidth=Math.max(3,Math.min(13,plotWidth/dayCount*.75));
    return `<rect x="${x-barWidth/2}" y="${plotBottom-height}" width="${barWidth}" height="${height}" rx="2" fill="#418aa2"><title>${escapeHtml(p.date)} · ${fmtMoney(p.price)} · ${p.markets} markets</title></rect>`;
  }).join('');
  const tickStep=dayCount>100?30:dayCount>45?14:7;
  const ticks=[];
  for(let d=0;d<dayCount;d+=tickStep){
    const day=new Date(Date.parse(start+'T00:00:00Z')+d*86400000).toISOString().slice(5,10);
    const x=x0+(d+.5)/dayCount*plotWidth;
    ticks.push(`<text x="${x}" y="${plotBottom+21}" text-anchor="middle" font-size="10" fill="#8fa599">${day}</text>`);
  }
  svg.innerHTML=grids+bars+ticks.join('')+(points.length?'':`<text x="${width/2}" y="133" text-anchor="middle" font-size="13" fill="#90a798">此窗口没有真实调查记录</text>`);
}

async function renderHistory(){
  const requestSequence=++historyRequestSequence;
  if(!store.overview||!store.index)return;
  const product=$('history-product').value,level=$('history-level').value,state=$('history-state').value,
    days=Number($('history-window').value),end=store.overview.survey_date;
  if(!product)return;
  $('chart-caption').textContent='正在载入历史观察记录…';
  const history=await loadHistory(product);
  // A slower previous request must never overwrite a newer level/state/window selection.
  if(requestSequence!==historyRequestSequence)return;
  const points=historySeries(history,{level,state,days,endDate:end});
  const start=new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
  $('chart-title').textContent=`${history.varieti} · ${level} · ${state||'全马'}`;
  $('chart-caption').textContent=`${start} 至 ${end} · ${points.length} 个有报价的调查日 · 缺失日期不补值`;
  drawChart(points,start,end);
  const ranked=statePrices(store.overview.prices,product,level),max=Math.max(1,...ranked.map(q=>q.price));
  $('states-caption').textContent=`${end} · ${level} · ${history.gred||'未分级'} · ${history.unit}`;
  $('states-bars').innerHTML=ranked.length?ranked.map(q=>
    `<div class="state-bar"><div class="state-name">${escapeHtml(q.state)}<small>${q.markets} 个市场</small></div><div class="state-track"><div class="state-fill" style="width:${(q.price/max*100).toFixed(1)}%"></div></div><div class="state-value">${fmtMoney(q.price)}</div></div>`
  ).join(''):'<p class="empty">最新调查日没有该产品的州别报价。</p>';
}

function updateProductAreaOptions(){
  const state=$('product-state').value,raw=store.detail.rawRows;
  const districtEl=$('product-district'),locationEl=$('product-location');
  if(!state||!raw){
    selectOptions(districtEl,[],{initialLabel:state?'正在读取 Daerah…':'先选择 Negeri'});
    selectOptions(locationEl,[],{initialLabel:'先选择 Daerah'});
    districtEl.disabled=true;locationEl.disabled=true;
    return;
  }
  const excluded=store.meta.superseded_priceids?.[store.overview.survey_date]||[];
  const districts=productAreaOptions(raw,{productKey:store.detail.key,state,excludedPriceIds:excluded}).districts;
  selectOptions(districtEl,districts,{initialLabel:'全部 Daerah'});
  districtEl.disabled=!districts.length;
  const district=districtEl.value;
  const locations=district?productAreaOptions(raw,{productKey:store.detail.key,state,district,
    excludedPriceIds:excluded}).locations:[];
  selectOptions(locationEl,locations,{initialLabel:district?'全部 Lokasi':'先选择 Daerah'});
  locationEl.disabled=!locations.length;
}

function renderProductPriceCards(){
  const productKey=store.detail.key,state=$('product-state').value,
    district=$('product-district').value,location=$('product-location').value;
  const isLocal=Boolean(district),excluded=store.meta.superseded_priceids?.[store.overview.survey_date]||[];
  const quotes=productScopePrices(store.overview.prices,store.detail.rawRows,
    {productKey,state,district,location,excludedPriceIds:excluded});
  const scope=isLocal?[state,district,location].filter(Boolean).join(' / '):state||'全马';
  $('product-scope-note').textContent=isLocal?
    `${scope} · 以此 Daerah / Lokasi 的真实调查市场计算（不是州平均）`:
    `${scope} · 该范围内不同调查市场等权计算；只展示最新调查日有记录的价格。`;
  $('product-level-cards').innerHTML=PRICE_LEVELS.map(level=>{
    const q=quotes?.find(x=>x.level===level),available=Number.isFinite(q?.price);
    return `<article class="detail-level-card"><span class="detail-level-name">${level}</span><strong>${available?fmtMoney(q.price):'—'}</strong><small>${available?`${q.markets} 个实际市场 · ${q.observations} 条有效记录`:
      isLocal&&!store.detail.rawRows?'原始档案读取中…':'此范围在当天无有效报价'}</small></article>`;
  }).join('');
}

function renderProductStates(){
  const key=store.detail.key,level=$('product-chart-level').value;
  const ranked=statePrices(store.overview.prices,key,level),max=Math.max(1,...ranked.map(q=>q.price));
  $('product-states-caption').textContent=`${store.overview.survey_date} · ${level} · 州级调查均价（不受 Daerah / Lokasi 筛选影响）`;
  $('product-states-bars').innerHTML=ranked.length?ranked.map(q=>
    `<div class="state-bar"><div class="state-name">${escapeHtml(q.state)}<small>${q.markets} 个市场</small></div><div class="state-track"><div class="state-fill" style="width:${(q.price/max*100).toFixed(1)}%"></div></div><div class="state-value">${fmtMoney(q.price)}</div></div>`
  ).join(''):'<p class="empty">该产品在当前调查日没有此层级的州别报价。</p>';
}

async function renderProductTrend(){
  const seq=++store.detail.historyRequest,key=store.detail.key,
    level=$('product-chart-level').value,state=$('product-state').value,
    days=Number($('product-chart-window').value),end=store.overview.survey_date;
  $('product-chart-caption').textContent='正在读取真实历史观察记录…';
  const history=await loadHistory(key);
  if(seq!==store.detail.historyRequest||key!==store.detail.key)return;
  const start=new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
  const points=historySeries(history,{level,state,days,endDate:end});
  $('product-chart-caption').textContent=`${start} 至 ${end} · ${state||'全马'} · ${level} · ${points.length} 个实际调查日`;
  drawChart(points,start,end,$('product-chart'));
}

function renderProductRaw(){
  const detail=store.detail,date=store.overview.survey_date,raw=detail.rawRows;
  if(!raw){
    $('product-raw-status').textContent=detail.rawError?'原始档案读取失败：'+detail.rawError:
      `正在读取 ${date} 的原始 FAMA CSV…`;
    $('product-raw-body').innerHTML='<tr><td colspan="8" class="empty">没有展示未经验证的原始记录。</td></tr>';
    $('product-raw-visible').textContent='尚未加载';$('product-raw-more').disabled=true;
    return;
  }
  const excluded=store.meta.superseded_priceids?.[date]||[];
  const filtered=productAreaRows(raw,{productKey:detail.key,state:$('product-state').value,
    district:$('product-district').value,location:$('product-location').value,excludedPriceIds:excluded});
  filtered.sort((a,b)=>a.negeri.localeCompare(b.negeri)||a.daerah.localeCompare(b.daerah)||
    a.lokasi.localeCompare(b.lokasi)||a.peringkat.localeCompare(b.peringkat));
  const visible=filtered.slice(0,detail.visible);
  $('product-raw-status').textContent=`${date} · ${filtered.length} 条原始市场记录（含空报价）；显示来源的实际地区、地点与 priceid。`;
  $('product-raw-visible').textContent=`显示 ${visible.length} / ${filtered.length} 条`;
  $('product-raw-more').disabled=visible.length>=filtered.length;
  $('product-raw-body').innerHTML=visible.length?visible.map(row=>
    `<tr><td>${escapeHtml(date)}</td><td>${escapeHtml(row.negeri)}</td><td>${escapeHtml(row.daerah)}</td><td>${escapeHtml(row.lokasi)}</td><td>${escapeHtml(row.peringkat)}</td><td class="price-cell">${fmtMoney(validPrice(row.harga))}</td><td>${escapeHtml(row.sublevel)}</td><td>${escapeHtml(row.priceid)}</td></tr>`
  ).join(''):'<tr><td colspan="8" class="empty">此范围没有该规格产品的 FAMA 原始报价。</td></tr>';
}

function renderProductDetail(){
  const entry=store.index?.products.find(x=>x.product_key===store.detail.key);
  if(!entry||!store.overview)return;
  $('product-title').textContent=entry.varieti;
  $('product-subtitle').textContent=`${entry.gred||'未分级'} · ${entry.unit} · ${entry.kategori||'FAMA 农产品'} · 精确匹配此品种、等级及单位`;
  $('product-date').textContent=`最新调查日：${store.overview.survey_date}`;
  renderProductPriceCards();renderProductStates();renderProductRaw();
  const scope=$('product-state').value||'全马';
  $('product-chart-scope').textContent=$('product-district').value?
    `注意：已选 ${scope} 的 Daerah / Lokasi，价格卡与原始市场表使用当地报价；历史图只显示 ${scope} 州／全国均价，因为旧档未发布地点级聚合历史。`:
    `历史图使用 ${scope} 在每天实际调查市场的等权均价；市场覆盖变化会影响趋势，不代表每个相同市场都涨跌。`;
  renderProductTrend().catch(e=>{
    $('product-chart-caption').textContent='历史读取失败：'+e.message;
    alertUser('无法读取此产品的历史数据：'+e.message,true);
  });
}

async function loadProductRaw(){
  const detail=store.detail,seq=++detail.rawRequest,key=detail.key,date=store.overview.survey_date;
  try{
    const rows=await loadDaily(date);
    if(seq!==detail.rawRequest||key!==detail.key)return;
    detail.rawRows=rows;detail.rawError='';
  }catch(error){
    if(seq!==detail.rawRequest||key!==detail.key)return;
    detail.rawRows=null;detail.rawError=error.message;
  }
  updateProductAreaOptions();
  if(store.page==='product')renderProductDetail();
}

function openProductDetail(key){
  if(!store.index?.products.some(x=>x.product_key===key))return alertUser('找不到产品的真实历史档案。',true);
  const detail=store.detail;
  detail.origin=store.page==='product'?detail.origin:store.page;
  detail.key=key;detail.rawRows=null;detail.rawError='';detail.visible=80;
  detail.rawRequest++;detail.historyRequest++;
  selectOptions($('product-state'),store.overview.states,{initialLabel:'全马平均'});
  $('product-state').value='';
  $('product-chart-level').value='Borong';$('product-chart-window').value='90';
  updateProductAreaOptions();navigate('product');
  loadProductRaw();
}

function renderExportDates(){
  if(!store.overview||!store.meta)return;
  const available=store.meta.archive_dates||[];
  const latest=store.overview.survey_date,earliest=available[0]||store.overview.first_archived_date;
  for(const id of ['export-from','export-to']){$(id).min=earliest;$(id).max=latest;}
  if(!$('export-to').value)$('export-to').value=latest;
  if(!$('export-from').value)$('export-from').value=latest;
}

function healthRows(values){
  return Object.entries(values).map(([key,val])=>`<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(val)}</dd></div>`).join('');
}
function renderHealth(){
  if(!store.overview)return;
  const data=store.overview;
  $('archive-health').innerHTML=healthRows({
    '最早价格调查':data.first_archived_date,'最新价格调查':data.survey_date,
    '保留的原始记录':Number(data.archived_rows).toLocaleString('en-MY'),
    '用于计算的记录':Number(data.canonical_rows).toLocaleString('en-MY'),
    '保留但不重复计价的修订记录':Number(data.superseded_rows).toLocaleString('en-MY'),
    '当前价格调查记录':Number(data.latest_survey_rows).toLocaleString('en-MY'),
    '本版 JSON 生成 UTC':data.generated_at_utc
  });
  const job=store.health;
  $('job-health').innerHTML=healthRows(job?{
    '监控状态':job.status==='ok'?'最近运行成功':job.status==='warning'?'需要关注':'运行失败',
    '最近 V3 重建 UTC':job.checked_at_utc||'—',
    '最近调查日期':job.latest_survey_date||'—',
    '重建触发方式':job.trigger||'—',
    '记录变化':job.changed_records===null?'无更新不代表失败':String(job.changed_records??'—')
  }:{'外部独立监控':'尚未接入独立调度服务','GitHub Actions':'请在仓库 Actions 查看最近执行日志',
    '最新价格':'请以左侧数据完整性栏为准'});
  $('job-health').insertAdjacentHTML('beforeend',healthRows({'GitHub 最近执行':'检查中…'}));
}

async function loadGitHubRunHealth(){
  const values=$('job-health');
  try{
    const result=await fetchJson('https://api.github.com/repos/Luke2929/bg-agro-price-tracker/actions/workflows/scrape.yml/runs?branch=master&per_page=5',true);
    const runs=result?.workflow_runs||[];
    const latest=runs[0],success=runs.find(r=>r.conclusion==='success');
    const html=healthRows({
      'GitHub 最近执行':latest?`${latest.created_at} · ${latest.status} / ${latest.conclusion||'处理中'}`:'没有可用执行记录',
      '最近 GitHub 成功':success?.created_at||'近期执行中未发现成功记录',
      '最近执行方式':latest?.event||'—'
    });
    const marker=values.lastElementChild;
    if(marker?.textContent?.includes('检查中'))marker.remove();
    values.insertAdjacentHTML('beforeend',html);
  }catch(error){
    const marker=values.lastElementChild;
    if(marker?.textContent?.includes('检查中'))marker.remove();
    values.insertAdjacentHTML('beforeend',healthRows({'GitHub 实时状态':'API 暂不可用；请在 Actions 页面核对'}));
  }
}

async function runExport(raw){
  if(store.fetching)return;
  const from=$('export-from').value,to=$('export-to').value,state=$('export-state').value,level=$('export-level').value;
  const valid=/^\d{4}-\d{2}-\d{2}$/;
  if(!valid.test(from)||!valid.test(to)||from>to||from<store.meta.window.min||to>store.meta.window.max){
    alertUser('请在现有 FAMA 档案日期范围内选择有效的起止日期。',true);return;
  }
  const dates=(store.meta.archive_dates||[]).filter(d=>d>=from&&d<=to);
  if(!dates.length){alertUser('选定日期没有存档 CSV。',true);return;}
  if(dates.length>45){alertUser('为避免浏览器内存不足，请每次导出最多 45 个有记录的调查日。',true);return;}
  store.fetching=true;
  const button=$(raw?'export-raw':'export-summary');button.disabled=true;
  try{
    const records=[];
    for(let i=0;i<dates.length;i++){
      const date=dates[i];
      $('export-progress').textContent=`正在读取 FAMA CSV · ${i+1} / ${dates.length} 个调查日 (${date})`;
      const rows=await loadDaily(date);
      for(const row of rows)if((!state||row.negeri===state)&&(!level||row.peringkat===level))records.push(row);
    }
    const summary=raw?null:summarizeRows(records,store.meta.superseded_priceids||{});
    const rows=raw?records:summary;
    if(!rows.length)throw Error('在所选日期及筛选条件下没有原始记录。');
    if(rows.length>150000)throw Error(`本次 ${rows.length} 行超过浏览器 Excel 上限，请缩小日期范围。`);
    const heads=raw?FAMA_COLUMNS:['Price Date','Variety','Grade','Unit','Price Level','State',
      'Market Equal-Weight Average (RM)','Markets','Original Observations','Category'];
    const lines=raw?rows.map(r=>FAMA_COLUMNS.map(key=>
      ['harga','average14'].includes(key)&&validPrice(r[key])!==null?Number(r[key]):r[key]))
      :summary.map(r=>[r.date,r.varieti,r.gred,r.unit,r.level,r.state,
        Number(r.price.toFixed(4)),r.markets,r.observations,r.category]);
    $('export-progress').textContent=`正在生成 Excel · ${lines.length.toLocaleString('en-MY')} 行`;
    const notes=[['Data source','FAMA AMI; archived daily CSV'],
      ['Price date','tarikh_harga is the survey date; not the download/execution date'],
      ['Range',`${from} through ${to}`],['State filter',state||'All Malaysia'],
      ['Level filter',level||'All three survey levels'],
      ['Granularity',raw?'All 17 source columns; includes superseded and blank-price source records':'One equal-weight average per distinct survey market; latest version of each priceid only'],
      ['Missing observations','Not estimated; blank prices are not zero'],
      ['Run timestamp','FAMA source date and scraper execution are distinct']];
    const filename=`Harga_Pasaran_${raw?'Full_Raw':'Summary'}_${from}_to_${to}.xlsx`;
    const blob=buildXlsx(heads,lines,{sheetName:raw?'Full Raw Data':'Summary Data',notes});
    downloadXlsx(blob,filename);
    $('export-progress').textContent=`已生成 ${filename} · ${lines.length.toLocaleString('en-MY')} 行；请检查浏览器下载。`;
    alertUser(`Excel 已生成：${lines.length.toLocaleString('en-MY')} 行。`);
  }catch(e){$('export-progress').textContent='导出未完成：'+e.message;alertUser(e.message,true);}
  finally{store.fetching=false;button.disabled=false;}
}

async function runPdfExport(type){
  if(store.fetching)return;
  const from=$('export-from').value,to=$('export-to').value,
    state=$('export-state').value,level=$('export-level').value;
  const valid=/^\d{4}-\d{2}-\d{2}$/;
  if(!valid.test(from)||!valid.test(to)||from>to||from<store.meta.window.min||to>store.meta.window.max){
    alertUser('请在真实 FAMA 存档范围内选择有效日期。',true);return;
  }
  const dates=(store.meta.archive_dates||[]).filter(date=>date>=from&&date<=to);
  if(!dates.length){alertUser('所选日期范围内没有原始 CSV。',true);return;}
  if(dates.length>45){alertUser('单次最多下载 45 个有存档的调查日。',true);return;}
  const button=$(type==='quick'?'export-pdf-quick':'export-pdf-full');
  store.fetching=true;button.disabled=true;
  try{
    const records=[];
    for(let i=0;i<dates.length;i++){
      const date=dates[i];
      $('export-progress').textContent=`正在读取原始 CSV · ${i+1} / ${dates.length} 个调查日 (${date})`;
      const rows=await loadDaily(date);
      for(const row of rows)if((!state||row.negeri===state)&&(!level||row.peringkat===level))records.push(row);
      if(type==='full'&&records.length>6500)throw Error('Full Mobile PDF 最多支持 6,500 条原始记录，请缩短日期或选择州别。大范围可以使用 Quick View PDF。');
    }
    if(!records.length)throw Error('所选日期、州属和价格层级没有 FAMA 记录。');
    $('export-progress').textContent=`正在生成 ${type==='quick'?'V3 州别价格速览':'V3 三级导航完整'} PDF · ${records.length.toLocaleString('en-MY')} 条原始记录`;
    const bytes=buildFamaPdf(records,{from,to,state,level,type,superseded:store.meta.superseded_priceids||{}});
    const filename=`Harga_Pasaran_${type==='quick'?'Quick_View':'Full_Mobile'}_${from}_to_${to}.pdf`;
    downloadPdf(bytes,filename);
    $('export-progress').textContent=`PDF 已生成：${filename}（${records.length.toLocaleString('en-MY')} 条记录）；请检查浏览器下载。`;
    alertUser(type==='quick'?'Quick View 已生成：以所选范围内最新调查日为价格速览，附日期覆盖说明。':'Full Mobile PDF 已生成：保留所选日期范围全部原始记录。');
  }catch(e){$('export-progress').textContent='PDF 导出未完成：'+e.message;alertUser(e.message,true);}
  finally{store.fetching=false;button.disabled=false;}
}

function bindEvents(){
  document.querySelectorAll('[data-page]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.page)));
  document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.go)));
  $('main').addEventListener('click',event=>{
    const btn=event.target.closest('[data-product-open]');
    if(btn)openProductDetail(btn.dataset.productOpen);
  });
  $('history-open-detail').addEventListener('click',()=>openProductDetail($('history-product').value));
  $('product-back').addEventListener('click',()=>navigate(store.detail.origin));
  $('product-state').addEventListener('change',()=>{
    $('product-district').value='';$('product-location').value='';
    store.detail.visible=80;updateProductAreaOptions();renderProductDetail();
  });
  $('product-district').addEventListener('change',()=>{
    $('product-location').value='';store.detail.visible=80;
    updateProductAreaOptions();renderProductDetail();
  });
  $('product-location').addEventListener('change',()=>{
    store.detail.visible=80;renderProductDetail();
  });
  for(const id of ['product-chart-level','product-chart-window'])
    $(id).addEventListener('change',renderProductDetail);
  $('product-raw-more').addEventListener('click',()=>{
    store.detail.visible+=80;renderProductRaw();
  });
  $('insight-survey-date').addEventListener('change',loadInsightDate);
  $('comparison-sort').addEventListener('change',renderComparisonRows);
  $('comparison-dialog').addEventListener('close',()=>{
    ++store.comparisonRequest;
    store.comparison=null;
  });
  document.querySelectorAll('[data-period], [data-insight-period]').forEach(btn=>btn.addEventListener('click',()=>{
    store.period=Number(btn.dataset.period||btn.dataset.insightPeriod);
    if(store.overview){renderMovers();renderDailyInsights();}
  }));
  $('main').addEventListener('click',async event=>{
    const data=store.insightData;
    const details=event.target.closest('[data-insight-details]');
    const copied=event.target.closest('[data-insight-copy]');
    const studio=event.target.closest('[data-insight-studio]');
    if((details||copied||studio)&&data){
      const direction=details?.dataset.insightDetails||copied?.dataset.insightCopy||studio.dataset.insightStudio;
      const period=store.period;
      const analysis=dailyStorySignals(data.prices,period);
      const quote=direction==='aligned'?
        analysis.aligned?.levels.find(item=>item.level===details.dataset.comparisonLevel):analysis[direction];
      const evidence=evidenceForQuote(quote,period,data.prices,data.survey_date);
      if(!evidence)return alertUser('当前报价不可比。',true);
      if(details)return showComparison(evidence);
      if(studio&&evidence.publishable)return creator.openTopic(evidence);
      if(!copied||!evidence.publishable||!verifiedInsightButtons.has(copied))return;
      try{
        const message=buildMarketPostIdea(quote,period,data.survey_date,data.prices);
        if(!message)throw Error('价格数据验证失败。');
        await navigator.clipboard.writeText(message);
        alertUser('已复制核对过的马来文选题。');
      }catch(error){
        alertUser('复制失败：'+error.message,true);
      }
    }
    const view=event.target.closest('[data-insight-view]');
    if(view&&data){
      $('price-change-period').value=String(store.period);
      $('price-change-order').value=view.dataset.insightView==='rise'?'rise':'fall';
      $('price-state').value='';
      $('price-level').value='';
      $('price-category').value='';
      $('price-search').value='';
      $('price-date').value=data.survey_date;
      if(store.priceData?.survey_date!==data.survey_date)loadPriceDate();
      else renderPrices();
      navigate('prices');
    }
  });
  for(const id of ['price-search','price-level','price-state','price-category']){
    $(id).addEventListener(id==='price-search'?'input':'change',()=>{store.visible=40;renderPrices();});
  }
  $('price-date').addEventListener('change',()=>loadPriceDate());
  $('price-date-latest').addEventListener('click',()=>{
    $('price-date').value=store.overview.survey_date;
    loadPriceDate();
  });
  for(const id of ['price-change-period','price-change-order','price-display-mode']){
    $(id).addEventListener('change',()=>{store.visible=40;renderPrices();});
  }
  document.querySelectorAll('[data-price-period]').forEach(btn=>btn.addEventListener('click',()=>{
    const period=btn.dataset.pricePeriod;
    const order=$('price-change-order');
    const prior=$('price-change-period').value;
    // Click 1: biggest increase; click 2: biggest decrease; click 3: reset.
    order.value=prior===period&&order.value==='rise'?'fall':
      prior===period&&order.value==='fall'?'name':'rise';
    $('price-change-period').value=period;
    store.visible=40;
    renderPrices();
  }));
  $('more-prices').addEventListener('click',()=>{store.visible+=40;renderPrices();});
  $('fetch-markets').addEventListener('click',loadMarkets);
  $('market-date').addEventListener('change',()=>{
    if(store.rawCache.has($('market-date').value))renderMarketRows();
    else $('market-status').textContent='调查日期已改变，请点击「读取市场记录」。';
  });
  for(const id of ['market-state','market-search','market-product'])
    $(id).addEventListener(id==='market-state'?'change':'input',renderMarketRows);
  $('price-table-body').addEventListener('click',event=>{
    const btn=event.target.closest('[data-watch-index]');
    if(btn){const quote=store.priceData?.prices[Number(btn.dataset.watchIndex)];if(quote)toggleSaved(quote);}
    const details=event.target.closest('[data-price-details]');
    if(details){
      const quote=store.priceData?.prices[Number(details.dataset.priceDetails)];
      const evidence=comparisonEvidence(quote,Number(details.dataset.comparisonPeriod));
      if(evidence)showComparison(evidence);
    }
  });
  $('watch-body').addEventListener('click',event=>{
    const btn=event.target.closest('[data-watch-remove]');if(!btn)return;
    store.watch.splice(Number(btn.dataset.watchRemove),1);writeWatch();renderWatchlist();renderPrices();
  });
  for(const id of ['history-product','history-level','history-state','history-window'])
    $(id).addEventListener('change',()=>renderHistory().catch(e=>failure(e.message)));
  $('export-summary').addEventListener('click',()=>runExport(false));
  $('export-raw').addEventListener('click',()=>runExport(true));
  $('export-pdf-quick').addEventListener('click',()=>runPdfExport('quick'));
  $('export-pdf-full').addEventListener('click',()=>runPdfExport('full'));
  $('reload').addEventListener('click',()=>load(true));
}

async function load(refresh=false){
  $('error-banner').hidden=true;$('reload').disabled=true;$('source-badge').textContent='正在核对最新调查数据';
  try{
    ++store.priceDateRequest; // Invalidate an older selected-date fetch during refresh.
    const [overview,index,meta,health]=await Promise.all([
      fetchJson(BASE+'overview.json',true),fetchJson(BASE+'history-index.json',true),
      fetchJson('../data/meta.json',true),fetchJson(BASE+'health.json',true).catch(()=>null)
    ]);
    if(overview?.schema!=='bg-agro/fama-overview/v3'||!Array.isArray(overview.prices)||
       index?.schema!=='bg-agro/fama-history-index/v3'||!Array.isArray(index.products)||
       !Array.isArray(meta.archive_dates))throw Error('V3 数据结构不完整，不能显示不可靠的报价。');
    if(overview.survey_date!==meta.window.max)throw Error('V3 最新调查日与原始 FAMA 清单不一致，请先重新生成数据。');
    store.overview=overview;store.index=index;store.meta=meta;store.health=health;store.history.clear();
    store.rawCache.clear();store.dailyPending.clear();store.snapshots.clear();store.streaks.clear();
    store.priceData=null;store.insightData=null;
    if($('comparison-dialog').open)$('comparison-dialog').close();
    selectOptions($('price-date'),[...meta.archive_dates].reverse(),{defaultValue:overview.survey_date});
    selectOptions($('insight-survey-date'),[...meta.archive_dates].reverse(),{defaultValue:overview.survey_date});
    selectOptions($('price-state'),overview.states,{initialLabel:'全马平均'});
    selectOptions($('export-state'),overview.states,{initialLabel:'全马'});
    selectOptions($('history-state'),overview.states,{initialLabel:'全马平均'});
    selectOptions($('market-state'),overview.states,{initialLabel:'全部州'});
    selectOptions($('market-date'),[...meta.archive_dates].reverse(),{defaultValue:overview.survey_date});
    selectOptions($('price-category'),[...new Set(overview.prices.map(p=>p.kategori).filter(Boolean))].sort(),{initialLabel:'全部分类'});
    const list=index.products.filter(p=>overview.prices.some(q=>q.product_key===p.product_key));
    selectOptions($('history-product'),list.map(p=>({value:p.product_key,label:productLabel(p)})),{
      defaultValue:list[0]?.product_key||''});
    renderSummary();loadInsightDate();renderWatchlist();renderExportDates();renderHealth();
    creator.refresh();
    loadPriceDate();
    if(store.page==='history')await renderHistory();
    if(store.page==='product'&&store.detail.key){
      store.detail.rawRows=null;store.detail.rawError='';store.detail.rawRequest++;
      updateProductAreaOptions();renderProductDetail();loadProductRaw();
    }
    if(refresh)alertUser('已刷新 V3 数据；最新 FAMA 调查日期：'+overview.survey_date);
  }catch(e){
    failure('无法验证 V3 FAMA 数据：'+e.message+'。旧版 Dashboard 与原始 CSV 档案未受影响。');
    $('source-badge').textContent='● 数据载入失败';$('source-badge').className='tag error';
  }finally{$('reload').disabled=false;}
}

readWatch();bindEvents();creator.bind();load();

