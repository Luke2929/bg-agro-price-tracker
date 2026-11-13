/* Creator V3.4: local-first UI, no platform API connections. */
import {
 WORKSPACE_KEY,emptyWorkspace,readWorkspace,saveRecord,contentMetrics,
 findContentSignals,composeCreatorDraft,observedStreak,formatPercent,
 toCSV,normalizeMetrics,isValidISODate
} from './creator-core.mjs';
import {escapeHtml,mytDate} from './engine.mjs';
const $=id=>document.getElementById(id),v=id=>$(id).value;
const metrics=['reach','likes','comments','shares','messages','joins','orders'];
const names={idea:'选题',draft:'草稿',scheduled:'计划发布',published:'已发布'};
const channels={facebook:'Facebook',tiktok:'TikTok',whatsapp:'WhatsApp'};
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
function makeCard(signal,platform){
  if(!signal?.publishable)throw Error('只有经过合格同市场核对的选题才允许导出');
  const width=1080,height=platform==='tiktok'?1920:1350;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas 不可用');
  const grad=ctx.createLinearGradient(0,0,width,height);
  grad.addColorStop(0,'#123a2e');grad.addColorStop(1,'#348065');
  ctx.fillStyle=grad;ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#e8f6e6';ctx.font='bold 36px system-ui';
  ctx.fillText('SKY AGRO  |  FAMA MARKET PRICE',75,100);
  ctx.fillStyle='#d2e8d8';ctx.font='30px system-ui';ctx.fillText('Malaysia · Agricultural price survey',75,156);
  ctx.fillStyle='#ffffff';ctx.font='bold 68px system-ui';
  const after=wrapped(ctx,signal.product,75,280,930,86,3);
  ctx.font='bold 32px system-ui';ctx.fillStyle='#d4eddd';
  ctx.fillText(signal.level+'  ·  '+(signal.region||'Malaysia'),75,after+62);
  const y=Math.max(510,after+98);
  ctx.fillStyle='#f5faf3';ctx.beginPath();ctx.roundRect(70,y,940,285,30);ctx.fill();
  ctx.fillStyle=signal.percent>0?'#246e4d':'#9d4f32';
  ctx.font='bold 150px system-ui';ctx.fillText(formatPercent(signal.percent),110,y+185);
  ctx.fillStyle='#4e7463';ctx.font='bold 30px system-ui';
  ctx.fillText(signal.period+' DAYS · MATCHED MARKETS',112,y+244);
  ctx.fillStyle='#e4f5e8';ctx.font='32px system-ui';
  ctx.fillText('Survey: '+signal.currentDate,75,y+370);
  ctx.fillText('Baseline: '+signal.previousDate,75,y+430);
  ctx.fillText('Shared markets: '+signal.markets,75,y+490);
  ctx.font='27px system-ui';ctx.fillStyle='#cfe8d4';
  wrapped(ctx,'Same variety, grade, unit, price level & market locations. Actual price and profits may differ.',75,y+560,920,42,4);
  ctx.font='bold 26px system-ui';ctx.fillStyle='#bcd8c3';
  ctx.fillText('Source: FAMA AMI · Independent compilation',75,height-76);
  canvas.toBlob(blob=>{
    if(blob)saveBlob(blob,'sky_agro_'+signal.currentDate+'_'+platform+'.png','image/png');
  },'image/png');
}
export function createCreatorWorkspace({getOverview,loadHistory,notify,navigate}){
  let workspace=emptyWorkspace(),blocked=false,editingId='',editingEvidence=null;
  let signals=[],pool=[],historicalRequest=0;
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
  const active=()=>pool[Number(v('creator-topic'))]||null;
  const currentEvidence=()=>editingId&&editingEvidence?editingEvidence:active();
  function evidence(){
    const s=currentEvidence();
    $('creator-evidence').textContent=s?
      s.product+' · '+s.level+' · '+(s.region||'全马')+' · '+formatPercent(s.percent)+
      ' · '+s.previousDate+' → '+s.currentDate+' · '+s.markets+' 个共同市场。'+
      '不能据此断言利润或涨跌原因。':
      '请先从选题情报中选择有合格 FAMA 比较的农产品。';
  }
  function signalsRender(){
    const data=getOverview();if(!data)return;
    signals=findContentSignals(data.prices,{period:Number(v('creator-signal-period')),
      region:v('creator-signal-region'),category:v('creator-signal-category'),
      query:v('creator-signal-search'),type:v('creator-signal-type')});
    const usable=signals.filter(x=>x.publishable);
    $('creator-signal-summary').textContent=data.survey_date+' · '+signals.length+
      ' 个候选，'+usable.length+' 个可研究，'+signals.filter(x=>x.flagged).length+
      ' 个含大幅异常。排序依内部选题评分；展示前 80 个。';
    $('creator-signal-list').innerHTML=signals.slice(0,80).map((s,i)=>{
      const tags=[s.aligned?'三层同步':'',s.divergent?'三层分化':'',
        s.flagged?'异常需核实':''].filter(Boolean).map(x=>'<span class="creator-pill">'+x+'</span>').join('');
      return '<article class="creator-signal-row">'+
       '<div class="creator-signal-name"><strong>'+escapeHtml(s.product)+'</strong><small>'+
       escapeHtml([s.grade,s.unit,s.level,s.region||'全马'].join(' · '))+
       '</small><div class="creator-tags">'+tags+'</div></div>'+
       '<div class="creator-signal-number"><b class="'+(s.percent>0?'creator-up':'creator-down')+'">'+
       formatPercent(s.percent)+'</b><small>'+escapeHtml(s.previousDate)+' → '+
       escapeHtml(s.currentDate)+' · '+s.markets+' 共同市场</small></div>'+
       '<div class="creator-score"><strong>'+s.score+'<small>/100</small></strong><span>选题优先级</span></div>'+
       '<div class="creator-actions"><button type="button" class="secondary-button small" data-creator-history="'+i+'">检查历史</button>'+
       '<button type="button" class="primary-button small" data-creator-draft="'+i+'"'+
       (s.publishable?'':' disabled')+'>写这条选题</button></div></article>';
    }).join('')||'<p class="empty">没有符合条件的市场信号。可以改变周期、地区或筛选类型。</p>';
    pool=usable;
    const sel=$('creator-topic'),last=sel.value;sel.replaceChildren();
    sel.add(new Option('请选择实际报价选题',''));
    pool.forEach((s,i)=>sel.add(new Option(s.product+' · '+s.level+' · '+
      formatPercent(s.percent)+' · '+(s.region||'全马'),String(i))));
    sel.value=[...sel.options].some(o=>o.value===last)?last:(pool.length?'0':'');
    evidence();
  }
  function refresh(){
    const data=getOverview();if(!data)return;
    choose($('creator-signal-region'),data.states.map(x=>({value:x,label:x})),'全国平均');
    choose($('creator-signal-category'),
      [...new Set(data.prices.map(q=>q.kategori).filter(Boolean))].sort().map(x=>({value:x,label:x})),'全部分类');
    signalsRender();calendarRender();
  }
  function generate(){
    editingId='';editingEvidence=null;
    const s=active();if(!s)return tell('请先选定符合样本条件的农产品。',true);
    try{
      const draft=composeCreatorDraft(s,{channel:v('creator-channel'),
        language:v('creator-language'),format:v('creator-format')});
      $('creator-title').value=draft.title;$('creator-body').value=draft.body;
      $('creator-status').value='draft';$('creator-editing-status').textContent='尚未保存';
      evidence();
    }catch(e){tell(e.message,true);}
  }
  function reset(){
    editingId='';editingEvidence=null;
    ['creator-title','creator-body','creator-notes','creator-scheduled-date','creator-posted-date',
      'creator-post-url'].forEach(id=>$(id).value='');
    $('creator-status').value='draft';$('creator-editing-status').textContent='新文章';
    evidence();
  }
  function save(){
    try{
      const title=v('creator-title').trim(),body=v('creator-body').trim();
      if(!title||!body)throw Error('标题及正文不能为空');
      if(v('creator-status')==='scheduled'&&!isValidISODate(v('creator-scheduled-date')))
        throw Error('计划发布需要有效日期');
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
        evidence:s||null,evidenceDate:s?.currentDate||''
      };
      persist(saveRecord(workspace,record));editingId=record.id;editingEvidence=s;
      $('creator-editing-status').textContent='已保存在此浏览器 · '+names[record.status];
      tell('草稿已保存。定期下载 JSON 备份，发布仍需手动操作。');calendarRender();
    }catch(e){tell('保存失败：'+e.message,true);}
  }
  function edit(id){
    const r=workspace.records.find(x=>x.id===id);if(!r)return;
    editingId=r.id;editingEvidence=r.evidence||null;
    const fields={'creator-title':r.title,'creator-body':r.body,'creator-status':r.status,
      'creator-channel':r.channel,'creator-language':r.language,
      'creator-format':r.format,'creator-scheduled-date':r.scheduledDate,
      'creator-posted-date':r.postedDate,'creator-post-url':r.postUrl,'creator-notes':r.notes};
    Object.entries(fields).forEach(([key,val])=>$(key).value=val||'');
    $('creator-editing-status').textContent='正在编辑：'+names[r.status];
    evidence();navigate('studio');
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
    ['creator-signal-period','creator-signal-region','creator-signal-category','creator-signal-type']
      .forEach(id=>$(id).addEventListener('change',signalsRender));
    $('creator-signal-search').addEventListener('input',signalsRender);
    $('creator-topic').addEventListener('change',()=>{
      editingId='';editingEvidence=null;evidence();
    });
    $('creator-generate').addEventListener('click',generate);
    $('creator-save').addEventListener('click',save);
    $('creator-new').addEventListener('click',reset);
    $('creator-copy').addEventListener('click',async()=>{
      try{
        if(!v('creator-body'))throw Error('没有可复制的正文');
        await navigator.clipboard.writeText(v('creator-body'));tell('已复制正文');
      }catch(e){tell('复制失败：'+e.message,true);}
    });
    $('creator-export-fb').addEventListener('click',()=>{
      try{makeCard(currentEvidence(),'facebook');}catch(e){tell(e.message,true);}
    });
    $('creator-export-tiktok').addEventListener('click',()=>{
      try{makeCard(currentEvidence(),'tiktok');}catch(e){tell(e.message,true);}
    });
    ['creator-calendar-month','creator-calendar-state','creator-calendar-platform']
      .forEach(id=>$(id).addEventListener('change',calendarRender));
    $('creator-metric-post').addEventListener('change',metricValues);
    $('creator-metric-save').addEventListener('click',metricsSave);
    $('creator-backup-json').addEventListener('click',backup);
    $('creator-export-csv').addEventListener('click',()=>{
      saveBlob('\ufeff'+toCSV(workspace),'sky_agro_creator_metrics_'+mytDate()+'.csv',
        'text/csv;charset=utf-8');
    });
    $('creator-import-json').addEventListener('change',e=>importBackup(e.target));
    $('creator-signal-list').addEventListener('click',e=>{
      const topic=e.target.closest('[data-creator-draft]');
      if(topic){
        const s=signals[Number(topic.dataset.creatorDraft)];
        if(!s?.publishable)return;
        const index=pool.findIndex(x=>x.id===s.id);
        if(index>=0){reset();$('creator-topic').value=String(index);evidence();navigate('studio');}
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
  return {bind,render,refresh};
}
