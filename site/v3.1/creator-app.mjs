/* Creator V3.4: local-first UI, no platform API connections. */
import {
 WORKSPACE_KEY,emptyWorkspace,readWorkspace,saveRecord,contentMetrics,
 findContentSignals,composeCreatorDraft,observedStreak,formatPercent,formatPrice,
 evidenceForQuote,validateCreatorDraft,draftSettings,statePriceSpreads,matchesTopic,
 toCSV,normalizeMetrics,isValidISODate
} from './creator-core.mjs';
import {escapeHtml,mytDate,comparisonMarketDetails} from './engine.mjs';
const $=id=>document.getElementById(id),v=id=>$(id).value;
const metrics=['reach','likes','comments','shares','messages','joins','orders'];
const names={idea:'选题',draft:'草稿',scheduled:'计划发布',published:'已发布'};
const channels={facebook:'Facebook',tiktok:'TikTok',whatsapp:'WhatsApp'};
const settingsInputs={
  showSource:'creator-source',mentionPage:'creator-mention-page',inviteFollow:'creator-invite-follow',
  mentionWhatsApp:'creator-mention-whatsapp',commentKeyword:'creator-comment-keyword',
  networking:'creator-networking',confirmedConversation:'creator-confirmed-conversation'
};
const formatNum=n=>Number(n||0).toLocaleString('en-MY');
function saveBlob(data,name,type){
  const u=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));
  const a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),3000);
}
function wrapped(ctx,word,x,y,width,lineHeight,limit){
  let line='',n=0;
  for(const ch of String(word||'')){
    if(ch==='\n'||ctx.measureText(line+ch).width>width&&line){
      ctx.fillText(line,x,y+n*lineHeight);line='';n++;
      if(n>=limit)return y+n*lineHeight;
      if(ch==='\n')continue;
    }
    line+=ch;
  }
  if(line&&n<limit){ctx.fillText(line,x,y+n*lineHeight);n++;}
  return y+n*lineHeight;
}
function makeCard(signal,platform,settings){
  const width=1080,height=platform==='tiktok'?1920:1350;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas 不可用');
  const grad=ctx.createLinearGradient(0,0,width,height);
  grad.addColorStop(0,'#123a2e');grad.addColorStop(1,'#348065');
  ctx.fillStyle=grad;ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#e8f6e6';ctx.font='bold 36px system-ui';
  ctx.fillText(settings.mentionPage?'SKY AGRO  |  MARKET PRICES':'AGRICULTURAL MARKET PRICES',75,100);
  ctx.fillStyle='#d2e8d8';ctx.font='30px system-ui';ctx.fillText('Matched-market survey',75,156);
  ctx.fillStyle='#ffffff';ctx.font='bold 68px system-ui';
  const after=wrapped(ctx,signal.product,75,235,930,75,3);
  ctx.font='bold 32px system-ui';ctx.fillStyle='#d4eddd';
  ctx.fillText(signal.level+'  ·  '+(signal.region||'Malaysia')+'  ·  '+(signal.grade||'Ungraded'),75,after+16,930);
  const y=Math.max(460,after+55);
  ctx.fillStyle='#f5faf3';ctx.beginPath();ctx.roundRect(70,y,940,285,30);ctx.fill();
  ctx.fillStyle=signal.percent>0?'#246e4d':'#9d4f32';
  ctx.font='bold 150px system-ui';ctx.fillText(formatPercent(signal.percent),110,y+185);
  ctx.fillStyle='#4e7463';ctx.font='bold 30px system-ui';
  ctx.fillText(signal.actualDays+' DAYS · '+signal.markets+' MATCHED MARKETS',112,y+244);
  ctx.fillStyle='#e4f5e8';ctx.font='32px system-ui';
  ctx.fillText(signal.previousDate+'  ·  '+formatPrice(signal.previousMean,signal.unit),75,y+355,930);
  ctx.fillText(signal.currentDate+'  ·  '+formatPrice(signal.currentMean,signal.unit),75,y+415,930);
  ctx.fillText('Difference  ·  '+formatPrice(signal.rmDifference,signal.unit,{signed:true}),75,y+475,930);
  ctx.font='27px system-ui';ctx.fillStyle='#cfe8d4';
  wrapped(ctx,'Each shared market carries the same weight. Local prices may vary.',75,y+550,920,38,2);
  if(settings.showSource){
    ctx.font='bold 26px system-ui';ctx.fillStyle='#bcd8c3';
    ctx.fillText('Source: FAMA AMI · Independent compilation',75,height-76);
  }
  canvas.toBlob(blob=>{
    if(blob)saveBlob(blob,'sky_agro_'+signal.currentDate+'_'+platform+'.png','image/png');
  },'image/png');
}
export function createCreatorWorkspace({
  getOverview,getArchiveDates,loadSnapshot,loadEvidenceRows,loadHistory,loadStreaks,showComparison,notify,navigate
}){
  let workspace=emptyWorkspace(),blocked=false,editingId='',editingEvidence=null,selectedEvidence=null;
  let signals=[],pool=[],signalData=null,verifiedEvidence=null;
  let historicalRequest=0,signalRequest=0,researchRequest=0,verificationRequest=0;
  let archiveChecks=new Map();
  const tell=(s,bad=false)=>notify(s,bad);
  const choose=(el,items,initial)=>{
    const prev=el.value;el.replaceChildren();el.add(new Option(initial,''));
    items.forEach(item=>el.add(new Option(item.label,item.value)));
    el.value=[...el.options].some(o=>o.value===prev)?prev:'';
  };
  function read(){
    try{workspace=readWorkspace(localStorage.getItem(WORKSPACE_KEY));blocked=false;}
    catch(e){blocked=true;tell('旧资料读取失败，禁止覆盖本地存档：'+e.message,true);}
  }
  function persist(next){
    if(blocked)throw Error('旧资料读取失败，保存被暂停');
    localStorage.setItem(WORKSPACE_KEY,JSON.stringify(next));workspace=next;
  }
  const active=()=>pool.find(s=>s.id===v('creator-topic'))||null;
  const currentEvidence=()=>editingId?editingEvidence:selectedEvidence;
  const options=()=>({
    channel:v('creator-channel'),language:v('creator-language'),format:v('creator-format'),
    settings:Object.fromEntries(Object.entries(settingsInputs).map(([key,id])=>[key,$(id).checked]))
  });
  const applySettings=settings=>{
    const checked=draftSettings(settings);
    for(const [key,id] of Object.entries(settingsInputs))$(id).checked=checked[key];
  };
  function updateValidation(){
    const draft={title:v('creator-title'),body:v('creator-body')};
    const validation=verifiedEvidence?
      validateCreatorDraft(draft,verifiedEvidence,options()):
      {valid:false,message:currentEvidence()?'请核对并重新生成文案。':'请选择调查数据并生成文案。'};
    for(const id of ['creator-copy','creator-export-fb','creator-export-tiktok'])$(id).disabled=!validation.valid;
    $('creator-validation').textContent=validation.message;
    $('creator-validation').classList.toggle('validation-error',!validation.valid&&Boolean(draft.body));
    return validation;
  }
  function evidence(){
    const s=currentEvidence();
    $('creator-evidence').textContent=s?
      [s.product,s.grade,s.level,s.region||'全国调查样本',formatPercent(s.percent),
        formatPrice(s.previousMean,s.unit)+' → '+formatPrice(s.currentMean,s.unit),
        (s.previousDate||'—')+' → '+(s.currentDate||'—'),
        Number.isInteger(s.actualDays)?'实际相隔 '+s.actualDays+' 天':'',
        Number.isInteger(s.markets)?s.markets+' 个共同市场':''].filter(Boolean).join(' · '):
      '请先从选题情报中选择有合格 FAMA 比较的农产品。';
    $('creator-studio-details').disabled=!verifiedEvidence;
    updateValidation();
  }
  const filters=()=>({
    period:Number(v('creator-signal-period')),region:v('creator-signal-region'),
    category:v('creator-signal-category'),query:v('creator-signal-search'),
    type:v('creator-signal-type'),level:v('creator-signal-level')
  });
  function renderTopics(value=''){
    const select=$('creator-topic');
    select.replaceChildren(new Option('请选择实际报价选题',''));
    for(const s of pool)select.add(new Option(s.product+' · '+s.level+' · '+
      formatPercent(s.percent)+' · '+(s.region||'全国调查样本')+' · '+s.currentDate,s.id));
    select.value=pool.some(s=>s.id===value)?value:'';
  }
  function signalsRender(){
    const data=signalData;
    if(!data)return;
    const filter=filters(),last=active();
    signals=findContentSignals(data.prices,filter);
    pool=signals.filter(x=>x.publishable);
    if(selectedEvidence&&!pool.some(x=>x.id===selectedEvidence.id))pool.unshift(selectedEvidence);
    renderTopics(last?.id||selectedEvidence?.id);
    $('creator-signal-summary').textContent=data.survey_date+' · '+signals.length+
      ' 个候选，'+signals.filter(x=>x.publishable).length+' 个可写，'+
      signals.filter(x=>x.flagged).length+' 个含大幅波动。展示前 80 个。';
    $('creator-signal-list').innerHTML=signals.slice(0,80).map((s,i)=>{
      const tags=[s.aligned?'三层同向':'',s.divergent?'层级分化':'',s.flagged?'波动待核实':'']
        .filter(Boolean).map(x=>'<span class="creator-pill">'+x+'</span>').join('');
      const levels=s.levels.filter(item=>item.level!==s.level).map(item=>
        '<small title="'+escapeHtml(item.previousDate+' → '+item.currentDate)+'">'+item.level+' '+
        escapeHtml(formatPrice(item.previousMean,item.unit)+' → '+formatPrice(item.currentMean,item.unit)+' · '+
        formatPrice(item.rmDifference,item.unit,{signed:true})+' · '+formatPercent(item.percent)+
        ' · '+item.actualDays+' 天 · '+item.markets+' 市场')+'</small>').join('');
      return '<article class="creator-signal-row">'+
        '<div class="creator-signal-name"><strong>'+escapeHtml(s.product)+'</strong><small>'+
        escapeHtml([s.grade,s.unit,s.region||'全国调查样本'].filter(Boolean).join(' · '))+
        '</small><div class="creator-tags">'+tags+'</div>'+levels+'</div>'+
        '<div class="creator-signal-number"><b class="'+(s.percent>0?'creator-up':'creator-down')+'">'+
        formatPercent(s.percent)+' <span class="price-level-pill price-level-'+s.level.toLowerCase()+'">'+s.level+
        '</span></b><small>'+escapeHtml(formatPrice(s.previousMean,s.unit)+' → '+formatPrice(s.currentMean,s.unit)+
        ' · '+formatPrice(s.rmDifference,s.unit,{signed:true}))+'</small><small>'+escapeHtml(s.previousDate)+' → '+
        escapeHtml(s.currentDate)+' · 实际 '+s.actualDays+' 天 · '+s.markets+' 个共同市场</small></div>'+
        '<div class="creator-score"><strong>'+s.score+'<small>/100</small></strong><span>选题优先级</span></div>'+
        '<div class="creator-actions"><button type="button" class="secondary-button small" data-creator-details="'+i+'">查看价格对比依据</button>'+
        '<button type="button" class="secondary-button small" data-creator-history="'+i+'">检查历史</button>'+
        '<button type="button" class="primary-button small" data-creator-draft="'+i+'"'+
        (s.publishable?'':' disabled')+'>写这条选题</button></div></article>';
    }).join('')||'<p class="empty">当前筛选暂无合格比较。可切换日期、周期、地区或层级。</p>';
    renderResearch(data,filter);
  }
  function renderResearch(data,filter){
    const research=++researchRequest;
    const prices=filter.level?data.prices.filter(q=>q.level===filter.level):data.prices;
    const spreads=statePriceSpreads(prices,filter).slice(0,3);
    $('creator-spreads').innerHTML=spreads.map(({low,high,difference})=>
      '<li><strong>'+escapeHtml(low.varieti+' · '+low.level+' · '+(low.gred||'未记录品级'))+'</strong><span>'+
      escapeHtml(low.state+' '+formatPrice(low.price,low.unit)+'（'+low.markets+' 市场） · '+
        high.state+' '+formatPrice(high.price,high.unit)+'（'+high.markets+' 市场） · 州际价差 '+
        formatPrice(difference,low.unit))+'</span></li>').join('');
    $('creator-spread-empty').hidden=Boolean(spreads.length);
    $('creator-trends').replaceChildren();
    $('creator-trend-status').textContent='正在核对最近三个有档案的调查日…';
    const labels=new Map(prices.map(q=>[q.product_key,q]));
    loadStreaks(data.survey_date,filter.region).then(trends=>{
      if(research!==researchRequest)return;
      const relevant=trends.filter(t=>(!filter.level||filter.level===t.level)&&
        labels.has(t.productKey)&&matchesTopic(labels.get(t.productKey),filter.category,filter.query));
      $('creator-trends').innerHTML=['rise','fall'].map(direction=>
        relevant.filter(t=>t.direction===direction).slice(0,2).map(t=>{
          const label=labels.get(t.productKey);
          return '<li><strong>'+escapeHtml(label.varieti+' · '+t.level+' · '+(label.gred||'未记录品级')+' · '+
            (direction==='rise'?'连续上涨':'连续下跌'))+'</strong><span>'+escapeHtml(t.points.map(p=>
            p.date+' '+formatPrice(p.price,label.unit)).join(' → ')+' · '+t.markets+' 个共同市场')+'</span></li>';
        }).join('')).join('');
      $('creator-trend-status').textContent=relevant.length?
        (filter.region||'全国调查样本')+' · 三个调查日使用同一组市场。':
        '当前筛选下暂无符合覆盖门槛的连续变化。';
    }).catch(error=>{
      if(research===researchRequest)$('creator-trend-status').textContent='趋势读取失败：'+error.message;
    });
  }
  function useSignalSnapshot(data){
    signalData=data;
    choose($('creator-signal-region'),data.states.map(x=>({value:x,label:x})),'全国调查样本');
    choose($('creator-signal-category'),
      [...new Set(data.prices.map(q=>q.kategori).filter(Boolean))].sort().map(x=>({value:x,label:x})),'全部分类');
    signalsRender();
  }
  async function changeSignalDate(){
    const request=++signalRequest,day=v('creator-signal-date');
    if(!day)return;
    ++researchRequest;
    signalData=null;
    signals=[];pool=selectedEvidence?[selectedEvidence]:[];
    renderTopics(selectedEvidence?.id);
    $('creator-signal-summary').textContent='正在读取 '+day+' 的调查比较…';
    $('creator-signal-list').replaceChildren();
    $('creator-trends').replaceChildren();
    $('creator-spreads').replaceChildren();
    $('creator-trend-status').textContent='正在读取所选调查日…';
    $('creator-spread-empty').hidden=true;
    try{
      const data=await loadSnapshot(day);
      if(request===signalRequest)useSignalSnapshot(data);
    }catch(error){
      if(request===signalRequest){
        $('creator-signal-summary').textContent=day+' 的比较无法读取：'+error.message;
        $('creator-trend-status').textContent='该调查日暂无法核对。';
      }
    }
  }
  function refresh(){
    const overview=getOverview();if(!overview)return;
    archiveChecks=new Map();
    const dates=[...getArchiveDates()].reverse();
    const select=$('creator-signal-date'),last=select.value;
    select.replaceChildren(...dates.map(day=>new Option(day,day)));
    select.value=dates.includes(last)?last:overview.survey_date;
    if(select.value===overview.survey_date){
      ++signalRequest;
      useSignalSnapshot(overview);
    }else changeSignalDate();
    calendarRender();
    if(currentEvidence())verifyEvidence();
  }
  function verifyAgainstArchive(s){
    const key=JSON.stringify([s.productKey,s.level,s.region,s.currentDate,s.period]);
    const checks=archiveChecks;
    if(checks.has(key))return checks.get(key);
    const pending=(async()=>{
      const data=await loadSnapshot(s.currentDate);
      const quote=data.prices.find(q=>q.product_key===s.productKey&&q.level===s.level&&q.state===s.region);
      const source=evidenceForQuote(quote,s.period,data.prices,s.currentDate);
      if(!source?.publishable)throw Error('此选题缺少可发布的合格比较。');
      const {rows,superseded}=await loadEvidenceRows(source);
      comparisonMarketDetails(rows,source,superseded);
      return source;
    })();
    checks.set(key,pending);
    pending.catch(()=>checks.delete(key));
    return pending;
  }
  async function verifyEvidence(){
    const request=++verificationRequest,s=currentEvidence();
    verifiedEvidence=null;
    evidence();
    if(!s?.productKey||!s.currentDate)return;
    $('creator-validation').textContent='正在核对原始市场记录…';
    try{
      const source=await verifyAgainstArchive(s);
      if(request!==verificationRequest)return;
      verifiedEvidence=source;
      if(editingId)editingEvidence=source;
      else selectedEvidence=source;
      evidence();
      return source;
    }catch(error){
      if(request===verificationRequest)$('creator-validation').textContent='价格数据验证失败。'+error.message;
    }
  }
  function openTopic(source){
    reset();
    selectedEvidence=source;
    if(!pool.some(s=>s.id===source.id))pool.unshift(source);
    renderTopics(source.id);
    navigate('studio');
  }
  async function generate(){
    const source=editingId?editingEvidence:active()||selectedEvidence;
    if(!source)return tell('请先选定符合样本条件的农产品。',true);
    if(!editingId)selectedEvidence=source;
    const verified=await verifyEvidence();
    if(!verified)return;
    try{
      const draft=composeCreatorDraft(verified,options());
      $('creator-title').value=draft.title;$('creator-body').value=draft.body;
      if(!editingId)$('creator-status').value='draft';
      $('creator-editing-status').textContent=editingId?'文案已更新，尚未保存':'尚未保存';
      evidence();
    }catch(error){tell(error.message,true);}
  }
  function reset({keepSettings=false}={}){
    ++verificationRequest;
    editingId='';editingEvidence=null;selectedEvidence=null;verifiedEvidence=null;
    ['creator-title','creator-body','creator-notes','creator-scheduled-date','creator-posted-date',
      'creator-post-url'].forEach(id=>$(id).value='');
    $('creator-topic').value='';
    if(!keepSettings)applySettings();
    $('creator-status').value='draft';$('creator-editing-status').textContent='新文章';
    evidence();
  }
  function save(){
    try{
      const title=v('creator-title').trim(),body=v('creator-body').trim();
      if(!title||!body)throw Error('标题及正文不能为空');
      if(v('creator-status')==='scheduled'&&!isValidISODate(v('creator-scheduled-date')))
        throw Error('计划发布需要有效日期');
      if(v('creator-status')==='published'&&!isValidISODate(v('creator-posted-date')))
        throw Error('已发布内容需要填写实际发布日期');
      const earlier=workspace.records.find(r=>r.id===editingId),now=new Date().toISOString();
      const s=currentEvidence();
      const record={
        id:editingId||((typeof crypto!=='undefined'&&crypto.randomUUID)?
          crypto.randomUUID():'post-'+Date.now()+'-'+Math.random().toString(36).slice(2)),
        createdAt:earlier?.createdAt||now,updatedAt:now,status:v('creator-status'),
        channel:v('creator-channel'),language:v('creator-language'),format:v('creator-format'),
        title,body,scheduledDate:v('creator-scheduled-date'),
        postedDate:v('creator-posted-date'),postUrl:v('creator-post-url'),
        notes:v('creator-notes'),metrics:earlier?.metrics||normalizeMetrics({}),
        evidence:s||null,evidenceDate:s?.currentDate||'',settings:options().settings
      };
      persist(saveRecord(workspace,record));editingId=record.id;editingEvidence=s;
      $('creator-editing-status').textContent='已保存在此浏览器 · '+names[record.status];
      tell('草稿已保存。定期下载 JSON 备份，发布仍需手动操作。');calendarRender();
    }catch(e){tell('保存失败：'+e.message,true);}
  }
  function edit(id){
    const r=workspace.records.find(x=>x.id===id);if(!r)return;
    editingId=r.id;editingEvidence=r.evidence||null;selectedEvidence=null;verifiedEvidence=null;
    const fields={'creator-title':r.title,'creator-body':r.body,'creator-status':r.status,
      'creator-channel':r.channel,'creator-language':r.language,
      'creator-format':r.format,'creator-scheduled-date':r.scheduledDate,
      'creator-posted-date':r.postedDate,'creator-post-url':r.postUrl,'creator-notes':r.notes};
    Object.entries(fields).forEach(([key,val])=>$(key).value=val||'');
    applySettings(r.settings);
    $('creator-topic').value='';
    $('creator-editing-status').textContent='正在编辑：'+names[r.status];
    evidence();navigate('studio');verifyEvidence();
  }
  async function inspectHistory(idx){
    const signal=signals[idx];if(!signal)return;
    const id=++historicalRequest;
    $('creator-streak').textContent='正在读取 '+signal.product+' 的历史观察序列…';
    try{
      const history=await loadHistory(signal.productKey);
      if(id!==historicalRequest)return;
      const streak=observedStreak(history,{level:signal.level,state:signal.region,
        endDate:signal.currentDate});
      const points=streak.points.map(p=>p.date+' RM'+p.price.toFixed(2)+
        '（'+p.markets+' 市场）').join(' → ');
      $('creator-streak').textContent=signal.product+' · '+signal.level+' · '+
        (streak.count?streak.count+' 段有记录调查日的均价'+
        (streak.direction==='rise'?'上行':'下行'):'暂无足够连续方向')+
        '。'+points+'。不同调查日可能采样不同市场，不是同市场持续涨跌结论。';
    }catch(e){if(id===historicalRequest)$('creator-streak').textContent='历史读取失败：'+e.message;}
  }
  function metricsMenu(){
    const selected=v('creator-metric-post'),el=$('creator-metric-post');
    el.replaceChildren();el.add(new Option('选择已发布帖子',''));
    workspace.records.filter(x=>x.status==='published')
      .forEach(r=>el.add(new Option(r.title.slice(0,55),r.id)));
    el.value=workspace.records.some(x=>x.id===selected&&x.status==='published')?selected:'';
    metricValues();
  }
  function metricValues(){
    const r=workspace.records.find(x=>x.id===v('creator-metric-post'));
    metrics.forEach(k=>$('creator-metric-'+k).value=r?.metrics?.[k]||0);
  }
  function metricsSave(){
    const post=workspace.records.find(x=>x.id===v('creator-metric-post'));
    if(!post||post.status!=='published')return tell('请先选择已发布的内容。',true);
    const m=Object.fromEntries(metrics.map(k=>[k,Number(v('creator-metric-'+k))]));
    if(metrics.some(k=>!Number.isInteger(m[k])||m[k]<0))return tell('表现指标必须为非负整数。',true);
    try{
      persist(saveRecord(workspace,{...post,metrics:normalizeMetrics(m),
        updatedAt:new Date().toISOString()}));
      calendarRender();$('creator-metric-post').value=post.id;metricValues();
      tell('人工表现数据已保存；未连接社媒平台。');
    }catch(e){tell(e.message,true);}
  }
  const recordDay=r=>r.status==='published'?
    (r.postedDate||r.scheduledDate):(r.scheduledDate||r.postedDate);
  function calendarRender(){
    const stats=contentMetrics(workspace);
    const items=[['总内容','records'],['草稿','drafts'],['计划发布','scheduled'],
      ['已发布','published'],['浏览','reach'],['留言','comments'],
      ['私讯','messages'],['入群','joins'],['订单','orders']];
    $('creator-kpis').innerHTML=items.map(([label,key])=>'<article class="creator-kpi"><span>'+
      label+'</span><strong>'+formatNum(stats[key])+'</strong></article>').join('');
    const month=v('creator-calendar-month'),filter=v('creator-calendar-state'),
      channel=v('creator-calendar-platform');
    const rows=workspace.records.filter(r=>(!filter||r.status===filter)&&
      (!channel||r.channel===channel)&&
      (!month||!recordDay(r)||recordDay(r).startsWith(month)))
      .sort((a,b)=>(recordDay(b)||b.updatedAt)
        .localeCompare(recordDay(a)||a.updatedAt));
    const shownMonth=/^\d{4}-\d{2}$/.test(month)?month:mytDate().slice(0,7);
    const year=Number(shownMonth.slice(0,4)),mon=Number(shownMonth.slice(5,7));
    const firstDay=new Date(Date.UTC(year,mon-1,1));
    const offset=(firstDay.getUTCDay()+6)%7; // Monday first
    const lastDay=new Date(Date.UTC(year,mon,0)).getUTCDate();
    const days=new Map();
    for(const r of rows){
      const day=recordDay(r);
      if(!day?.startsWith(shownMonth))continue;
      if(!days.has(day))days.set(day,[]);
      days.get(day).push(r);
    }
    const headings=['一','二','三','四','五','六','日']
      .map(day=>'<span class="creator-day-title">'+day+'</span>').join('');
    const blanks=Array.from({length:offset},()=>'<span class="creator-day creator-day-blank"></span>').join('');
    let cells='';
    for(let number=1;number<=lastDay;number++){
      const day=shownMonth+'-'+String(number).padStart(2,'0');
      const events=days.get(day)||[];
      const isToday=day===mytDate();
      cells+='<div class="creator-day'+(isToday?' creator-day-today':'')+'">'+
        '<span class="creator-day-number">'+number+'</span>'+
        events.slice(0,3).map(r=>
          '<button type="button" class="creator-day-event creator-event-'+
          r.status+'" data-creator-edit="'+escapeHtml(r.id)+'" title="'+
          escapeHtml(names[r.status]+' · '+r.title)+'">'+
          escapeHtml(r.title.slice(0,17))+'</button>').join('')+
        (events.length>3?'<small>另有 '+(events.length-3)+' 篇</small>':'')+
        '</div>';
    }
    $('creator-calendar-grid').innerHTML=headings+blanks+cells;
    $('creator-schedule').innerHTML=rows.map(r=>
      '<article class="creator-calendar-entry"><div><strong>'+escapeHtml(r.title)+
      '</strong><small>'+channels[r.channel]+' · '+names[r.status]+' · '+
      escapeHtml(recordDay(r)||'尚未排期')+'</small>'+
      (r.postUrl?'<a href="'+escapeHtml(r.postUrl)+'" target="_blank" rel="noopener noreferrer">打开原帖 ↗</a>':'')+
      '</div><div class="creator-actions"><button type="button" class="secondary-button small" data-creator-edit="'+
      escapeHtml(r.id)+'">编辑</button><button type="button" class="secondary-button small" data-creator-delete="'+
      escapeHtml(r.id)+'">删除</button></div></article>'
    ).join('')||'<p class="empty">这里还没有内容。去内容工作室保存第一篇草稿。</p>';
    const top=workspace.records.filter(r=>r.status==='published').sort(
      (a,b)=>b.metrics.comments+b.metrics.shares-a.metrics.comments-a.metrics.shares).slice(0,5);
    $('creator-top-posts').innerHTML=top.length?
      '<h3>互动最多的内容（仅手动录入）</h3>'+top.map(r=>'<div class="creator-leader"><strong>'+
      escapeHtml(r.title)+'</strong><span>'+formatNum(r.metrics.reach)+' Views · '+
      formatNum(r.metrics.comments)+' Comments · '+formatNum(r.metrics.messages)+' DM · '+
      formatNum(r.metrics.joins)+' Joins</span></div>').join(''):
      '<p class="creator-help">发布后手动填入真实平台数据，就可以比较内容表现。</p>';
    metricsMenu();
    $('creator-storage-note').textContent=blocked?'本地存档读取异常，已阻止覆盖。':
      '浏览器本地已保存 '+workspace.records.length+' 篇。排期只是记录，既不自动通知也不自动发帖；请定期导出备份。';
  }
  function backup(){saveBlob(JSON.stringify(workspace,null,2),
    'sky_agro_creator_v34_'+mytDate()+'.json','application/json;charset=utf-8');}
  async function importBackup(input){
    const file=input.files?.[0];if(!file)return;
    try{
      if(file.size>5*1024*1024)throw Error('JSON 文件不可超过 5 MB');
      const snapshot=readWorkspace(await file.text());
      if(!confirm('导入会覆盖此浏览器当前 '+workspace.records.length+
        ' 篇内容，以备份中的 '+snapshot.records.length+' 篇替换。确认继续？'))return;
      localStorage.setItem(WORKSPACE_KEY,JSON.stringify(snapshot));
      workspace=snapshot;blocked=false;reset();calendarRender();tell('备份导入成功');
    }catch(e){tell('导入失败：'+e.message,true);}
    finally{input.value='';}
  }
  function bind(){
    read();$('creator-calendar-month').value=mytDate().slice(0,7);
    ['creator-signal-period','creator-signal-region','creator-signal-category','creator-signal-type','creator-signal-level']
      .forEach(id=>$(id).addEventListener('change',signalsRender));
    $('creator-signal-date').addEventListener('change',changeSignalDate);
    $('creator-signal-search').addEventListener('input',signalsRender);
    $('creator-topic').addEventListener('change',()=>{
      const next=active();
      reset({keepSettings:true});
      selectedEvidence=next;
      $('creator-topic').value=next?.id||'';
      evidence();
    });
    for(const id of ['creator-title','creator-body'])$(id).addEventListener('input',updateValidation);
    for(const id of ['creator-channel','creator-language','creator-format',...Object.values(settingsInputs)])
      $(id).addEventListener('change',updateValidation);
    $('creator-generate').addEventListener('click',generate);
    $('creator-save').addEventListener('click',save);
    $('creator-new').addEventListener('click',()=>reset());
    $('creator-copy').addEventListener('click',async()=>{
      try{
        const validation=updateValidation();
        if(!validation.valid)throw Error(validation.message);
        await navigator.clipboard.writeText(v('creator-body'));tell('已复制正文');
      }catch(e){tell('复制失败：'+e.message,true);}
    });
    for(const [id,platform] of [['creator-export-fb','facebook'],['creator-export-tiktok','tiktok']]){
      $(id).addEventListener('click',()=>{
        try{
          const validation=updateValidation();
          if(!validation.valid)throw Error(validation.message);
          makeCard(verifiedEvidence,platform,options().settings);
        }catch(e){tell(e.message,true);}
      });
    }
    $('creator-studio-details').addEventListener('click',()=>{
      if(verifiedEvidence)showComparison(verifiedEvidence);
    });
    ['creator-calendar-month','creator-calendar-state','creator-calendar-platform']
      .forEach(id=>$(id).addEventListener('change',calendarRender));
    $('creator-metric-post').addEventListener('change',metricValues);
    $('creator-metric-save').addEventListener('click',metricsSave);
    $('creator-backup-json').addEventListener('click',backup);
    $('creator-export-csv').addEventListener('click',async()=>{
      const button=$('creator-export-csv');
      const snapshot=workspace,checks=archiveChecks;
      const verified=new Set();
      button.disabled=true;
      try{
        for(let i=0;i<snapshot.records.length;i+=4){
          await Promise.all(snapshot.records.slice(i,i+4).map(async record=>{
            const s=record.evidence;
            if(!s?.productKey||!s.currentDate)return;
            try{
              const source=await verifyAgainstArchive(s);
              if(validateCreatorDraft(record,source,record).valid)verified.add(record.id);
            }catch{/* The metrics export keeps the row and leaves its unverified title blank. */}
          }));
          if(checks!==archiveChecks)throw Error('行情已刷新，请重新导出。');
        }
        saveBlob('\ufeff'+toCSV(snapshot,{includeTitle:r=>verified.has(r.id)}),
          'sky_agro_creator_metrics_'+mytDate()+'.csv','text/csv;charset=utf-8');
        if(verified.size<snapshot.records.length)tell('成效 CSV 已导出，未核对的标题留空。');
      }catch(error){tell(error.message,true);}
      finally{button.disabled=false;}
    });
    $('creator-import-json').addEventListener('change',e=>importBackup(e.target));
    $('creator-signal-list').addEventListener('click',e=>{
      const topic=e.target.closest('[data-creator-draft]');
      if(topic){
        const s=signals[Number(topic.dataset.creatorDraft)];
        if(s?.publishable)openTopic(s);
      }
      const detail=e.target.closest('[data-creator-details]');
      if(detail){
        const s=signals[Number(detail.dataset.creatorDetails)];
        if(s)showComparison(s);
      }
      const trend=e.target.closest('[data-creator-history]');
      if(trend)inspectHistory(Number(trend.dataset.creatorHistory));
    });
    $('creator-calendar-grid').addEventListener('click',e=>{
      const action=e.target.closest('[data-creator-edit]');
      if(action)edit(action.dataset.creatorEdit);
    });
    $('creator-schedule').addEventListener('click',e=>{
      const btn=e.target.closest('[data-creator-edit]');
      if(btn)return edit(btn.dataset.creatorEdit);
      const gone=e.target.closest('[data-creator-delete]');
      if(!gone)return;
      const found=workspace.records.find(r=>r.id===gone.dataset.creatorDelete);
      if(!found||!confirm('确定删除「'+found.title+'」？只能从 JSON 备份恢复。'))return;
      try{
        persist({...workspace,records:workspace.records.filter(r=>r.id!==found.id)});
        if(editingId===found.id)reset();
        calendarRender();
      }catch(err){tell(err.message,true);}
    });
  }
  function render(page){
    if(page==='signals')signalsRender();
    if(page==='studio')evidence();
    if(page==='calendar')calendarRender();
  }
  return {bind,render,refresh,openTopic};
}
