import {FAMA_COLUMNS,escapeHtml,fmtMoney,fmtDate,ageDays,mytDate,quoteChange,
  rankMovers,filterQuotes,productLabel,historySeries,statePrices,parseCSV,
  validPrice,summarizeRows} from './engine.mjs';
import {buildXlsx,downloadXlsx} from './excel.mjs';

const $=id=>document.getElementById(id);
const BASE='../data/v3/';
const RAW_BASE='https://raw.githubusercontent.com/Luke2929/bg-agro-price-tracker/master/data/daily/';
const PAGE_NAMES={overview:'农价总览',prices:'价格明细',history:'历史与州别',watchlist:'我的关注',export:'Excel 导出',system:'运行状态'};
const store={overview:null,index:null,meta:null,health:null,history:new Map(),page:'overview',
  period:1,visible:40,watch:[],fetching:false,rawCache:new Map()};
let historyRequestSequence=0;

async function fetchJson(path,refresh=false){
  const response=await fetch(path+(refresh?(path.includes('?')?'&':'?')+'t='+Date.now():''),
    {cache:refresh?'no-store':'default'});
  if(!response.ok)throw Error(`数据读取失败 (${response.status})：${path}`);
  return response.json();
}

function alertUser(message,error=false){
  const toast=$('toast');toast.textContent=message;toast.hidden=false;
  toast.style.background=error?'#9b5040':'#204c39';
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
  window.scrollTo({top:0,behavior:'instant'});
}

function percentMarkup(quote,period){
  const change=quoteChange(quote,period);
  if(!change)return '<span class="delta-empty" title="没有达到同市场样本门槛或缺少可比日期">—</span>';
  const positive=change.percent>0,negative=change.percent<0;
  const cls=positive?'delta-positive':negative?'delta-negative':'';
  const sign=positive?'+':'';
  return `<span class="${cls}" title="对比 ${escapeHtml(change.previousDate)} · ${change.markets} 个共同市场">${sign}${change.percent.toFixed(1)}%</span>`;
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
  $('hero-date').textContent=fmtDate(data.survey_date);
  $('stat-survey').textContent=fmtDate(data.survey_date);
  $('stat-age').textContent=age===0?'马来西亚今日已有价格记录':age>0?`距离今日 ${age} 天 · 不冒充今日价格`:'来源价格调查日';
  $('stat-rows').textContent=Number(data.valid_latest_rows).toLocaleString('en-MY');
  $('stat-states').textContent=data.states.length+' / 16';
  $('stat-quotes').textContent=data.prices.length.toLocaleString('en-MY');
  renderMovers();
  const shortlist=data.prices.filter(p=>!p.state&&p.level==='Borong').slice(0,8);
  $('quick-prices').innerHTML=shortlist.length?shortlist.map(p=>
    `<div class="quick-item"><strong title="${escapeHtml(productLabel(p))}">${escapeHtml(p.varieti)}</strong><span>${fmtMoney(p.price)}</span><small>${escapeHtml(p.gred||'未分级')} · ${escapeHtml(p.unit)} · ${p.markets} 个市场</small></div>`
  ).join(''):'<p class="empty">暂无批发层级调查记录。</p>';
}

function renderMovers(){
  document.querySelectorAll('[data-period]').forEach(btn=>btn.classList.toggle('active',Number(btn.dataset.period)===store.period));
  for(const direction of ['up','down']){
    const list=rankMovers(store.overview.prices,store.period,direction);
    $(direction==='up'?'movers-up':'movers-down').innerHTML=list.length?list.map(p=>
      `<div class="mover"><div style="min-width:0"><strong title="${escapeHtml(productLabel(p))}">${escapeHtml(p.varieti)}</strong><small>${escapeHtml(p.level)} · ${p.change.markets} 个共同市场 · ${escapeHtml(p.change.previousDate)} 基准</small></div><b class="${direction==='up'?'positive':'negative'}">${p.change.percent>0?'+':''}${p.change.percent.toFixed(1)}%</b></div>`
    ).join(''):'<p class="empty">这一观察窗口暂无符合样本门槛的可比涨跌。</p>';
  }
}

function filters(){return {search:$('price-search').value,level:$('price-level').value,
  state:$('price-state').value,category:$('price-category').value};}
function renderPrices(){
  if(!store.overview)return;
  const matches=filterQuotes(store.overview.prices,filters());
  const visible=matches.slice(0,store.visible);
  $('price-table-status').textContent=`${fmtDate(store.overview.survey_date)} · ${matches.length} 组可见报价`;
  $('price-table-body').innerHTML=visible.map(p=>{
    const id=store.overview.prices.indexOf(p);
    return `<tr><td><strong>${escapeHtml(p.varieti)}</strong><small>${escapeHtml([p.gred,p.unit].filter(Boolean).join(' · '))}</small></td><td>${escapeHtml(p.level)}</td><td>${escapeHtml(p.state||'全马')}</td><td class="price-cell">${fmtMoney(p.price)}</td><td>${percentMarkup(p,1)}</td><td>${percentMarkup(p,7)}</td><td>${percentMarkup(p,30)}</td><td>${p.markets}<small>${p.observations} 条记录</small></td><td><button class="star ${isSaved(p)?'saved':''}" data-watch-index="${id}" aria-label="${isSaved(p)?'取消关注':'加入关注'}">${isSaved(p)?'★':'☆'}</button></td></tr>`;
  }).join('')||'<tr><td colspan="9" class="empty">当前条件没有 FAMA 调查报价。</td></tr>';
  $('price-visible').textContent=`显示 ${visible.length} / ${matches.length} 组`;
  $('more-prices').disabled=matches.length<=store.visible;
}

async function loadDaily(date){
  if(store.rawCache.has(date))return store.rawCache.get(date);
  const revision=store.meta.archive_versions?.[date]||store.meta.generated_at_utc||'';
  const url=RAW_BASE+encodeURIComponent(date)+'.csv'+(revision?'?rev='+encodeURIComponent(revision):'');
  const response=await fetch(url);
  if(!response.ok)throw Error(`${date} 原始档案 HTTP ${response.status}。`);
  const rows=parseCSV(await response.text());
  if(rows.some(row=>row.tarikh_harga!==date))throw Error(`${date} CSV 存在调查日期不一致。`);
  store.rawCache.set(date,rows);
  return rows;
}

function renderMarketRows(){
  const date=$('market-date').value,rows=store.rawCache.get(date);
  if(!rows)return;
  const state=$('market-state').value,place=$('market-search').value.trim().toLocaleUpperCase(),
    product=$('market-product').value.trim().toLocaleUpperCase();
  const superseded=new Set(store.meta.superseded_priceids?.[date]||[]);
  const matching=rows.filter(r=>!superseded.has(r.priceid)&&(!state||r.negeri===state)&&
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
    return `<tr><td><strong>${escapeHtml(q.varieti)}</strong><small>${escapeHtml([q.gred,q.unit].filter(Boolean).join(' · '))}</small></td><td>${escapeHtml(q.level)}</td><td>${escapeHtml(q.state||'全马')}</td><td class="price-cell">${fmtMoney(q.price)}</td><td>${percentMarkup(q,1)}</td><td>${percentMarkup(q,7)}</td><td>${percentMarkup(q,30)}</td><td><button class="text-button" data-watch-remove="${index}">移除</button></td></tr>`;
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

function drawChart(points,start,end){
  const svg=$('history-chart');
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
    return `<rect x="${x-barWidth/2}" y="${plotBottom-height}" width="${barWidth}" height="${height}" rx="2" fill="#4b9877"><title>${escapeHtml(p.date)} · ${fmtMoney(p.price)} · ${p.markets} markets</title></rect>`;
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
    const notes=[['Data source','FAMA AMI; original BG Agro daily CSV archive'],
      ['Price date','tarikh_harga is the survey date; not the download/execution date'],
      ['Range',`${from} through ${to}`],['State filter',state||'All Malaysia'],
      ['Level filter',level||'All three survey levels'],
      ['Granularity',raw?'All 17 source columns; includes superseded and blank-price source records':'One equal-weight average per distinct survey market; latest version of each priceid only'],
      ['Missing observations','Not estimated; blank prices are not zero'],
      ['Run timestamp','FAMA source date and scraper execution are distinct']];
    const filename=`BG_Agro_${raw?'Full_Raw':'Summary'}_${from}_to_${to}.xlsx`;
    const blob=buildXlsx(heads,lines,{sheetName:raw?'Full Raw Data':'Summary Data',notes});
    downloadXlsx(blob,filename);
    $('export-progress').textContent=`已生成 ${filename} · ${lines.length.toLocaleString('en-MY')} 行；请检查浏览器下载。`;
    alertUser(`Excel 已生成：${lines.length.toLocaleString('en-MY')} 行。`);
  }catch(e){$('export-progress').textContent='导出未完成：'+e.message;alertUser(e.message,true);}
  finally{store.fetching=false;button.disabled=false;}
}

function bindEvents(){
  document.querySelectorAll('[data-page]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.page)));
  document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.go)));
  document.querySelectorAll('[data-period]').forEach(btn=>btn.addEventListener('click',()=>{
    store.period=Number(btn.dataset.period);if(store.overview)renderMovers();
  }));
  for(const id of ['price-search','price-level','price-state','price-category']){
    $(id).addEventListener(id==='price-search'?'input':'change',()=>{store.visible=40;renderPrices();});
  }
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
    if(btn){const quote=store.overview.prices[Number(btn.dataset.watchIndex)];if(quote)toggleSaved(quote);}
  });
  $('watch-body').addEventListener('click',event=>{
    const btn=event.target.closest('[data-watch-remove]');if(!btn)return;
    store.watch.splice(Number(btn.dataset.watchRemove),1);writeWatch();renderWatchlist();renderPrices();
  });
  for(const id of ['history-product','history-level','history-state','history-window'])
    $(id).addEventListener('change',()=>renderHistory().catch(e=>failure(e.message)));
  $('export-summary').addEventListener('click',()=>runExport(false));
  $('export-raw').addEventListener('click',()=>runExport(true));
  $('reload').addEventListener('click',()=>load(true));
}

async function load(refresh=false){
  $('error-banner').hidden=true;$('reload').disabled=true;$('source-badge').textContent='正在核对最新调查数据';
  try{
    const [overview,index,meta,health]=await Promise.all([
      fetchJson(BASE+'overview.json',true),fetchJson(BASE+'history-index.json',true),
      fetchJson('../data/meta.json',true),fetchJson(BASE+'health.json',true).catch(()=>null)
    ]);
    if(overview?.schema!=='bg-agro/fama-overview/v3'||!Array.isArray(overview.prices)||
       index?.schema!=='bg-agro/fama-history-index/v3'||!Array.isArray(index.products)||
       !Array.isArray(meta.archive_dates))throw Error('V3 数据结构不完整，不能显示不可靠的报价。');
    if(overview.survey_date!==meta.window.max)throw Error('V3 最新调查日与原始 FAMA 清单不一致，请先重新生成数据。');
    store.overview=overview;store.index=index;store.meta=meta;store.health=health;store.history.clear();
    store.rawCache.clear();
    selectOptions($('price-state'),overview.states,{initialLabel:'全马平均'});
    selectOptions($('export-state'),overview.states,{initialLabel:'全马'});
    selectOptions($('history-state'),overview.states,{initialLabel:'全马平均'});
    selectOptions($('market-state'),overview.states,{initialLabel:'全部州'});
    selectOptions($('market-date'),[...meta.archive_dates].reverse(),{defaultValue:overview.survey_date});
    selectOptions($('price-category'),[...new Set(overview.prices.map(p=>p.kategori).filter(Boolean))].sort(),{initialLabel:'全部分类'});
    const list=index.products.filter(p=>overview.prices.some(q=>q.product_key===p.product_key));
    selectOptions($('history-product'),list.map(p=>({value:p.product_key,label:productLabel(p)})),{
      defaultValue:list[0]?.product_key||''});
    renderSummary();renderPrices();renderWatchlist();renderExportDates();renderHealth();
    if(store.page==='history')await renderHistory();
    if(refresh)alertUser('已刷新 V3 数据；最新 FAMA 调查日期：'+overview.survey_date);
  }catch(e){
    failure('无法验证 V3 FAMA 数据：'+e.message+'。旧版 Dashboard 与原始 CSV 档案未受影响。');
    $('source-badge').textContent='● 数据载入失败';$('source-badge').className='tag error';
  }finally{$('reload').disabled=false;}
}

readWatch();bindEvents();load();
