/* FAMA market heatmap: evidence-based product treemap, no synthetic prices. */
import {comparisonEvidence,escapeHtml,fmtMoney,ageDays,isValidISODate} from './engine.mjs?rev=v3-5-completeness-1';

const VALID_PERIODS=[1,7,30];
const VALID_LEVELS=['Ladang','Borong','Runcit'];
const round=n=>Math.round(n*10)/10;
const position=n=>Number.isFinite(n)?Math.max(0,n).toFixed(2):'0';
const tooltipValue=n=>Number.isFinite(n)?n.toFixed(1)+'%':'—';

export const ALL_STATES='__ALL_STATES__';
export const MALAYSIA_STATES=[
  'JOHOR','KEDAH','KELANTAN','MELAKA','NEGERI SEMBILAN','PAHANG',
  'PERAK','PERLIS','PULAU PINANG','SABAH','SARAWAK','SELANGOR',
  'TERENGGANU','W.P. KUALA LUMPUR','W.P. LABUAN','W.P. PUTRAJAYA'
];

// Real matched-market calculations with too few shared markets to be a robust
// statewide trend. Keep their provenance and a permanent small-sample label.
export function smallSampleEvidence(quote,period){
  const days=Number(period),c=quote?.changes?.[String(days)];
  if(![1,7,30].includes(days)||!c||c.eligible!==false||
    !isValidISODate(quote?.date)||c.currentDate!==quote.date||
    !isValidISODate(c.previousDate)||!['Ladang','Borong','Runcit'].includes(quote.level)||
    typeof quote.state!=='string'||!quote.varieti||!quote.unit)return null;
  const actual=ageDays(c.previousDate,quote.date);
  const window={1:6,7:4,30:7}[days];
  if(actual!==c.actualDays||actual<days||actual>days+window||c.days!==days||
    !Number.isInteger(c.markets)||c.markets<1||
    !Number.isInteger(c.currentMarkets)||!Number.isInteger(c.previousMarkets)||
    c.currentMarkets<c.markets||c.previousMarkets<c.markets||
    !Number.isFinite(c.current)||c.current<0||!Number.isFinite(c.previous)||c.previous<=0||
    !Number.isFinite(c.percent)||!Number.isFinite(c.rmDifference))return null;
  const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&
    Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
  const coverageNow=c.markets/c.currentMarkets,coverageBefore=c.markets/c.previousMarkets;
  const raw=(c.current-c.previous)/c.previous*100;
  if(!close(coverageNow,c.currentCoverage)||!close(coverageBefore,c.previousCoverage)||
    !close(c.current-c.previous,c.rmDifference)||
    !close(c.percent,Math.abs(raw)<0.05?0:raw)||
    (c.rawPercent!==undefined&&!close(c.rawPercent,raw)))return null;
  // Do not reinterpret unexplained source ineligibility as a verified claim.
  if(c.markets>=3&&coverageNow>=.5&&coverageBefore>=.5)return null;
  return {
    productKey:quote.product_key,product:quote.varieti,grade:quote.gred,unit:quote.unit,
    level:quote.level,region:quote.state,period:days,actualDays:actual,
    currentDate:quote.date,previousDate:c.previousDate,
    currentMean:c.current,previousMean:c.previous,rmDifference:c.rmDifference,
    percent:c.percent,markets:c.markets,currentMarkets:c.currentMarkets,
    previousMarkets:c.previousMarkets,currentCoverage:coverageNow,
    previousCoverage:coverageBefore,quality:'small-sample'
  };
}

export function prepareHeatmap(prices,{
  level='Borong',state=ALL_STATES,period=7,limit=120,
  search='',category='',sort='coverage'
}={}){
  if(!Array.isArray(prices)||!VALID_LEVELS.includes(level)||
     !VALID_PERIODS.includes(Number(period))||typeof state!=='string')
    return {groups:[],tiles:[],total:0,shown:0,excluded:0,comparable:0,coverage:0};
  const allStates=state===ALL_STATES;
  const source=prices.filter(q=>q?.level===level&&
    (allStates?MALAYSIA_STATES.includes(q.state):q.state===state));
  const query=String(search||'').trim().toLocaleUpperCase();
  const candidates=[];
  for(const quote of source){
    if(category&&quote.kategori!==category)continue;
    if(query&&![quote.varieti,quote.gred,quote.unit].some(v=>
      String(v||'').toLocaleUpperCase().includes(query)))continue;
    const strictEvidence=comparisonEvidence(quote,Number(period),quote.date);
    const provisional=strictEvidence?null:smallSampleEvidence(quote,Number(period));
    const evidence=strictEvidence||provisional;
    if(!allStates&&!state&&!evidence)continue;
    candidates.push({
      key:quote.product_key,name:quote.varieti,grade:quote.gred||'未分级',
      unit:quote.unit,category:String(quote.kategori||'未分类').trim()||'未分类',
      percent:evidence?.percent??null,level,region:quote.state,evidence,
      quality:strictEvidence?'strict':provisional?'small-sample':'no-comparison',
      markets:evidence?.markets??quote.markets, surveyedMarkets:quote.markets,
      price:quote.price,previousMean:evidence?.previousMean??null,
      currentMean:evidence?.currentMean??null,previousDate:evidence?.previousDate??null,
      currentDate:quote.date,actualDays:evidence?.actualDays??null,
      weight:Math.max(1,evidence?.markets??quote.markets??1)
    });
  }
  const byName=(a,b)=>a.name.localeCompare(b.name)||a.grade.localeCompare(b.grade);
  const byPercent=(a,b,mode)=>{
    const x=Number.isFinite(a.percent),y=Number.isFinite(b.percent);
    if(x!==y)return x?-1:1; // unmatched values always at the end
    if(x&&y){
      const diff=mode==='rise'?b.percent-a.percent:mode==='fall'?a.percent-b.percent:
        Math.abs(b.percent)-Math.abs(a.percent);
      if(diff)return diff;
    }
    return byName(a,b);
  };
  const sortRows=(items)=>items.sort((a,b)=>{
    if(sort==='name')return byName(a,b);
    if(sort==='rise'||sort==='fall'||sort==='swing')return byPercent(a,b,sort);
    return b.weight-a.weight||byName(a,b);
  });
  sortRows(candidates);
  const comparable=candidates.filter(x=>x.evidence).length;
  const strict=candidates.filter(x=>x.quality==='strict').length;
  const smallSample=candidates.filter(x=>x.quality==='small-sample').length;
  if(allStates){
    // The national board previews at most 9 per state. The state header reveals
    // the true full count and opens the complete, uncapped state view.
    const groups=MALAYSIA_STATES.map(name=>{
      const all=candidates.filter(tile=>tile.region===name);
      return {name,weight:1,items:all.slice(0,9),observed:all.length,
        comparable:all.filter(tile=>tile.evidence).length,
        strict:all.filter(tile=>tile.quality==='strict').length,
        smallSample:all.filter(tile=>tile.quality==='small-sample').length,
        totalActual:source.filter(q=>q.state===name).length};
    });
    const tiles=groups.flatMap(g=>g.items);
    return {groups,tiles,total:candidates.length,shown:tiles.length,comparable,strict,
      smallSample,coverage:groups.filter(g=>g.totalActual>0).length,
      excluded:candidates.length-comparable,allStates:true};
  }
  // A single selected state displays every matching product, never an arbitrary
  // "first 75/130" cutoff. The plain national aggregate keeps its earlier limit.
  const tiles=state?candidates:candidates.slice(0,Math.max(1,Math.min(250,Number(limit)||120)));
  const grouped=new Map();
  for(const tile of tiles){
    if(!grouped.has(tile.category))grouped.set(tile.category,
      {name:tile.category,weight:0,items:[]});
    const group=grouped.get(tile.category);
    group.items.push(tile);group.weight+=tile.weight;
  }
  const groups=[...grouped.values()].sort((a,b)=>b.weight-a.weight||
    a.name.localeCompare(b.name));
  return {groups,tiles,total:candidates.length,shown:tiles.length,comparable,
    strict,smallSample,coverage:Number(source.length>0),
    excluded:candidates.length-comparable,allStates:false};
}

// Squarified treemap. Both group and product areas are proportional to market coverage.
export function treemapLayout(items,width,height){
  if(!Array.isArray(items)||width<=0||height<=0)return [];
  const list=items.map((item,i)=>({...item,index:i,area:Number(item.weight)}))
    .filter(item=>Number.isFinite(item.area)&&item.area>0)
    .sort((a,b)=>b.area-a.area||a.index-b.index);
  const sum=list.reduce((v,item)=>v+item.area,0);
  if(!sum)return [];
  const scale=width*height/sum;
  for(const item of list)item.area*=scale;
  let rect={x:0,y:0,w:width,h:height};
  const output=[];
  const worst=(row,side)=>{
    if(!row.length||side<=0)return Infinity;
    const areas=row.map(item=>item.area),sum=areas.reduce((a,b)=>a+b,0);
    return Math.max(side*side*Math.max(...areas)/(sum*sum),
      (sum*sum)/(side*side*Math.min(...areas)));
  };
  const place=(row)=>{
    if(!row.length)return;
    const area=row.reduce((a,item)=>a+item.area,0);
    if(rect.w>=rect.h){
      const rowWidth=rect.h>0?Math.min(rect.w,area/rect.h):0;
      let y=rect.y;
      for(let i=0;i<row.length;i++){
        const h=i===row.length-1?rect.y+rect.h-y:
          rowWidth>0?row[i].area/rowWidth:0;
        output.push({item:row[i],x:rect.x,y,w:rowWidth,h:Math.max(0,h)});
        y+=h;
      }
      rect={x:rect.x+rowWidth,y:rect.y,w:Math.max(0,rect.w-rowWidth),h:rect.h};
    }else{
      const rowHeight=rect.w>0?Math.min(rect.h,area/rect.w):0;
      let x=rect.x;
      for(let i=0;i<row.length;i++){
        const w=i===row.length-1?rect.x+rect.w-x:
          rowHeight>0?row[i].area/rowHeight:0;
        output.push({item:row[i],x,y:rect.y,w:Math.max(0,w),h:rowHeight});
        x+=w;
      }
      rect={x:rect.x,y:rect.y+rowHeight,w:rect.w,h:Math.max(0,rect.h-rowHeight)};
    }
  };
  let row=[];
  for(const item of list){
    if(!row.length||worst([...row,item],Math.min(rect.w,rect.h))<=
      worst(row,Math.min(rect.w,rect.h)))row.push(item);
    else{place(row);row=[item];}
  }
  place(row);
  return output;
}

export function heatmapColor(percent,quality='strict'){
  // Confidence is intentionally NOT part of the hue or lightness. The same
  // percentage has exactly the same color regardless of matched market count.
  if(!Number.isFinite(percent))return '#34484b'; // No comparison (N/A)
  if(Math.abs(percent)<0.05)return '#667780'; // Verified 0.0%, not missing.
  const intensity=Math.min(1,Math.log1p(Math.abs(percent))/Math.log1p(30));
  const light=Math.round(42-13*intensity);
  return percent>0?'hsl(153 78% '+light+'%)':'hsl(355 75% '+light+'%)';
}

export function createMarketHeatmap({loadSnapshot,showComparison,showProductHistory,notify}){
  const $=id=>document.getElementById(id);
  const canvas=$('market-heatmap-canvas');
  const dateSlider=$('market-heatmap-date');
  const dateValue=$('market-heatmap-date-value');
  const status=$('market-heatmap-status');
  const summary=$('market-heatmap-summary');
  const detail=$('market-heatmap-detail');
  const playButton=$('market-heatmap-play');
  const previousButton=$('market-heatmap-prev');
  const nextButton=$('market-heatmap-next');
  const latestButton=$('market-heatmap-latest');
  const speedSelector=$('market-heatmap-speed');
  const dateCount=$('market-heatmap-date-count');
  const dateTicks=$('market-heatmap-ticks');
  let dates=[],snapshot=null,selection=0,token=0,playing=false,playTimer=null,tiles=[];
  let observer=null;

  const setPlayLabel=()=>{
    const parts=playButton.querySelectorAll('span');
    if(parts.length===2){
      parts[0].textContent=playing?'Ⅱ':'▶';
      parts[1].textContent=playing?'暂停回放':'开始回放';
    }
    playButton.setAttribute('aria-pressed',String(playing));
    playButton.setAttribute('aria-label',playing?'暂停历史行情回放':'开始历史行情回放');
  };
  const updateDateControls=()=>{
    const n=dates.length;
    const progress=n>1?100*selection/(n-1):100;
    dateSlider.style.setProperty('--replay-progress',progress.toFixed(2)+'%');
    dateSlider.setAttribute('aria-valuetext',dates[selection]||'无可用调查日');
    dateCount.textContent=n?(selection+1)+' / '+n+' 次调查':'— / —';
    dateValue.textContent=dates[selection]||'—';
    previousButton.disabled=n<2||selection<=0;
    nextButton.disabled=n<2||selection>=n-1;
    latestButton.disabled=n===0||selection>=n-1;
    speedSelector.disabled=n<2;
  };
  const stop=()=>{
    playing=false;clearTimeout(playTimer);playTimer=null;
    ++token; // Cancel a pending archive load when playback is interrupted.
    setPlayLabel();
    if(snapshot){status.textContent='已核对：'+snapshot.survey_date;status.dataset.loading='false';}
  };
  const state=()=>({
    level:$('market-heatmap-level').value,
    region:$('market-heatmap-state').value,
    period:Number($('market-heatmap-period').value)
  });
  const rectStyle=(r)=>'left:'+position(r.x)+'px;top:'+position(r.y)+
    'px;width:'+position(r.w)+'px;height:'+position(r.h)+'px';
  const paint=()=>{
    if(!snapshot)return;
    const filter=state(),allStates=filter.region===ALL_STATES;
    const w=canvas.clientWidth;
    if(w<100)return;
    // State overview uses equal-size state panels; no state silently disappears.
    const columns=w>=1040?4:w>=720?3:2;
    const rows=Math.ceil(MALAYSIA_STATES.length/columns);
    canvas.classList.toggle('all-states',allStates);
    canvas.style.height=allStates?String(rows*(w<550?244:252))+'px':'';
    const h=canvas.clientHeight;
    if(h<100)return;
    const result=prepareHeatmap(snapshot.prices,{
      level:filter.level,state:filter.region,period:filter.period,
      limit:w<700?75:130
    });
    tiles=[];
    const label=filter.period===1?'昨日':filter.period+' 天';
    const regionLabel=allStates?'全马州别':filter.region||'全国均价';
    summary.textContent=allStates?
      snapshot.survey_date+' · '+filter.level+' · 全马 16 州／直辖区 · 有该层级报价 '+
        result.coverage+'/16 · '+label+'严格比较 '+result.strict+
        ' 组 · 小样本比较 '+result.smallSample+' 组；其余只有当日价格':
      snapshot.survey_date+' · '+filter.level+' · '+regionLabel+' · '+label+
        '严格比较 '+result.strict+' 组 · 小样本比较 '+result.smallSample+' 组'+
        (result.excluded?' · '+result.excluded+' 组仅有当日价格':'');
    dateValue.textContent=snapshot.survey_date;
    if(!result.groups.length){
      canvas.innerHTML='<div class="market-heatmap-empty">当前筛选没有满足同市场样本门槛的涨跌数据。<span>可切换价格层级、地区或比较周期。</span></div>';
      detail.textContent='只显示实际 FAMA 价格，不补造缺失的比较数据。';return;
    }
    const groupRects=allStates?
      result.groups.map((group,i)=>({
        item:group,x:(i%columns)*w/columns,y:Math.floor(i/columns)*h/rows,
        w:w/columns,h:h/rows
      })):
      treemapLayout(result.groups,w,h);
    let index=0,markup='';
    for(const r of groupRects){
      const group=r.item;
      if(r.w<1||r.h<1)continue;
      const showHeader=allStates||r.h>=52&&r.w>=100;
      const head=showHeader?(allStates?31:24):0;
      const innerW=Math.max(0,r.w-4),innerH=Math.max(0,r.h-head-4);
      const itemRects=allStates?
        group.items.map((item,i)=>({
          item,x:(i%2)*innerW/2,
          y:Math.floor(i/2)*innerH/Math.ceil(group.items.length/2),
          w:innerW/2,h:innerH/Math.ceil(group.items.length/2)
        })):
        treemapLayout(group.items,innerW,innerH);
      const cells=itemRects.map(t=>{
        const item=t.item,idx=index++;tiles[idx]=item;
        const huge=t.w>=132&&t.h>=99;
        const medium=t.w>=77&&t.h>=62;
        const tiny=t.w<58||t.h<37;
        const move=item.evidence?(item.percent>0?'+':'')+tooltipValue(item.percent):'—';
        const current=fmtMoney(item.price);
        const display=item.evidence?move:current;
        const reliability=item.quality==='strict'?'严格同市场对比':
          item.quality==='small-sample'?'小样本观察，不代表全州趋势':'不可比';
        const label=item.name+' · '+item.grade+' · '+filter.level+
          ' · '+(item.evidence?move+' · '+reliability+' · 共同市场 '+item.markets:
            '当日均价 '+current+'/'+item.unit+' · '+item.surveyedMarkets+
            ' 个报价市场 · 涨跌不可比');
        const content='<span class="market-hm-name">'+escapeHtml(item.name)+'</span>'+
          (tiny?'':'<strong class="market-hm-change">'+escapeHtml(display)+'</strong>')+
          (huge?'<small>'+escapeHtml(item.grade)+'</small>':'');
        return '<button type="button" class="market-hm-cell'+
          (huge?' large':medium?' medium':tiny?' tiny':'')+
          (item.quality==='small-sample'?' small-sample':item.evidence?'':' uncomparable')+
          '" data-market-hm-index="'+idx+
          '" title="'+escapeHtml(label)+'" aria-label="'+escapeHtml(label)+
          '" style="'+rectStyle(t)+';background:'+heatmapColor(item.percent,item.quality)+'">'+
          content+'</button>';
      }).join('');
      const groupDescription=allStates?
        (group.observed?
          (group.observed+' 报价 · '+group.strict+' 严格 · '+group.smallSample+' 小样本'):
          '该层级当天无报价'):
        group.items.length+' 项';
      const placeholder=allStates&&!group.items.length?
        '<div class="market-hm-no-data">该调查日此层级无报价<br><small>不使用其他日期填补</small></div>':'';
      markup+='<div class="market-hm-group'+(allStates?' market-hm-state':'')+
        '" style="'+rectStyle(r)+'" title="'+escapeHtml(group.name)+'">'+
        (showHeader?'<div class="market-hm-group-header"><strong>'+escapeHtml(group.name)+
          '</strong><span>'+escapeHtml(groupDescription)+'</span></div>':'')+
        '<div class="market-hm-group-body" style="top:'+head+'px">'+
        cells+placeholder+'</div></div>';
    }
    canvas.innerHTML=markup;
    detail.textContent=allStates?
      '选择某个州的色块，可以查看该产品在该州的全部历史价格、日期及来源记录。鲜艳红绿＝严格可比，柔和红绿＝小样本。':
      '悬停查看报价，点击有可比涨跌的色块核对逐市场记录。';
  };
  const showDetail=event=>{
    const btn=event.target.closest('[data-market-hm-index]');
    if(!btn||!canvas.contains(btn))return;
    const item=tiles[Number(btn.dataset.marketHmIndex)];
    if(!item)return;
    if(!item.evidence){
      detail.textContent=item.region+' · '+item.name+' · '+item.grade+' · '+
        item.level+' | '+item.currentDate+' 当日市场均价 '+
        fmtMoney(item.price)+' / '+item.unit+' | '+item.surveyedMarkets+
        ' 个报价市场；没有达到同市场 3 个共同市场及覆盖率 50% 的比较标准，因此不显示涨跌百分比。';
      return;
    }
    const direction=item.percent>0?'上涨':item.percent<0?'下跌':'持平';
    detail.textContent=(item.region||'全国')+' · '+item.name+' · '+item.grade+
      ' | '+item.level+' | '+item.previousDate+' → '+item.currentDate+
      '（实际 '+item.actualDays+' 天） | 同市场均价 '+
      fmtMoney(item.previousMean)+' / '+item.unit+' → '+
      fmtMoney(item.currentMean)+' / '+item.unit+' | '+direction+' '+
      Math.abs(item.percent).toFixed(1)+'% | '+item.markets+' 个共同市场'+
      (item.quality==='small-sample'?' · ⚠ 小样本观察，不代表全州趋势':' · 严格同市场对比')+
      (Math.abs(item.percent)>=50?' · ⚠ 大幅波动，建议核实原始报价':'');
  };
  const chooseDate=async(index)=>{
    if(!dates.length)return false;
    const current=++token,day=dates[index];
    status.textContent='正在核对 '+day+' 的历史调查与比较市场…';
    status.dataset.loading='true';
    try{
      const data=await loadSnapshot(day);
      if(current!==token)return false;
      if(data.survey_date!==day)throw Error('档案日期与请求不一致');
      snapshot=data;selection=index;dateSlider.value=String(index);
      status.textContent='已核对：'+day;
      status.dataset.loading='false';
      updateDateControls();paint();
      return true;
    }catch(error){
      if(current===token){
        status.textContent=day+' 读取失败：'+error.message;
        status.dataset.loading='false';
        notify('Heatmap 历史日期读取失败：'+error.message,true);
      }
      return false;
    }
  };
  const step=async()=>{
    if(!playing)return;
    if(selection>=dates.length-1){stop();return;}
    const ok=await chooseDate(selection+1);
    if(!playing)return;
    if(!ok){stop();return;}
    if(selection>=dates.length-1){stop();return;}
    playTimer=setTimeout(step,Number(speedSelector.value)||1050);
  };
  const bind=()=>{
    $('market-heatmap-period').addEventListener('change',()=>{stop();paint();});
    for(const id of ['market-heatmap-state','market-heatmap-level'])
      $(id).addEventListener('change',()=>{stop();paint();});
    dateSlider.addEventListener('input',()=>{
      stop();
      const i=Number(dateSlider.value),day=dates[i];
      if(!day)return;
      const progress=dates.length>1?100*i/(dates.length-1):100;
      dateSlider.style.setProperty('--replay-progress',progress.toFixed(2)+'%');
      status.textContent='选择调查日：'+day;
    });
    dateSlider.addEventListener('change',()=>{
      const index=Number(dateSlider.value);
      stop();chooseDate(index);
    });
    previousButton.addEventListener('click',()=>{
      if(selection<=0)return;
      stop();chooseDate(selection-1);
    });
    nextButton.addEventListener('click',()=>{
      if(selection>=dates.length-1)return;
      stop();chooseDate(selection+1);
    });
    latestButton.addEventListener('click',()=>{
      if(!dates.length)return;
      stop();chooseDate(dates.length-1);
    });
    speedSelector.addEventListener('change',()=>{
      if(playing&&playTimer!==null){
        clearTimeout(playTimer);
        playTimer=setTimeout(step,Number(speedSelector.value)||1050);
      }
    });
    playButton.addEventListener('click',()=>{
      if(playing){stop();return;}
      if(dates.length<2)return;
      playing=true;setPlayLabel();
      if(selection>=dates.length-1){
        chooseDate(0).then(ok=>{
          if(!playing)return;
          if(!ok){stop();return;}
          playTimer=setTimeout(step,Number(speedSelector.value)||1050);
        });
      }else step();
    });
    canvas.addEventListener('pointerover',showDetail);
    canvas.addEventListener('focusin',showDetail);
    canvas.addEventListener('click',event=>{
      const btn=event.target.closest('[data-market-hm-index]');
      if(btn&&canvas.contains(btn)){
        const tile=tiles[Number(btn.dataset.marketHmIndex)];
        if(tile?.region&&typeof showProductHistory==='function'){
          stop();
          showProductHistory(tile.key,tile.region,tile.level);
        }else if(tile?.quality==='strict'&&tile.evidence)showComparison(tile.evidence);
        else if(tile)showDetail({target:btn});
      }
    });
    if(typeof ResizeObserver!=='undefined'){
      observer=new ResizeObserver(()=>paint());observer.observe(canvas);
    }else window.addEventListener('resize',paint);
  };
  const refresh=(overview,meta)=>{
    stop();++token;
    if(!overview||!Array.isArray(meta?.archive_dates))return;
    dates=meta.archive_dates.filter(day=>day<=overview.survey_date).slice(-32);
    if(!dates.includes(overview.survey_date))dates.push(overview.survey_date);
    selection=dates.length-1;
    dateSlider.min='0';dateSlider.max=String(Math.max(0,selection));
    dateSlider.value=String(selection);dateSlider.disabled=dates.length<=1;
    playButton.disabled=dates.length<=1;
    dateTicks.innerHTML=dates.length>1?dates.map((_,index)=>
      '<span style="--tick-position:'+(100*index/(dates.length-1)).toFixed(2)+'%"></span>'
    ).join(''):'';
    updateDateControls();setPlayLabel();
    $('market-heatmap-first-date').textContent=dates[0]||'—';
    $('market-heatmap-last-date').textContent=dates.at(-1)||'—';
    const selector=$('market-heatmap-state'),before=selector.value;
    selector.replaceChildren(new Option('全马各州（16 州／直辖区）',ALL_STATES),
      new Option('全国均价（同市场）',''));
    for(const region of MALAYSIA_STATES)selector.add(new Option(region,region));
    selector.value=before===ALL_STATES||before===''?ALL_STATES:
      MALAYSIA_STATES.includes(before)?before:ALL_STATES;
    snapshot=overview;status.textContent='已核对：'+overview.survey_date;
    status.dataset.loading='false';paint();
  };
  return {bind,refresh,paint,stop};
}
