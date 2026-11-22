/* FAMA market heatmap: evidence-based product treemap, no synthetic prices. */
import {comparisonEvidence,escapeHtml,fmtMoney} from './engine.mjs?rev=v3-5-completeness-1';

const VALID_PERIODS=[1,7,30];
const VALID_LEVELS=['Ladang','Borong','Runcit'];
const round=n=>Math.round(n*10)/10;
const position=n=>Number.isFinite(n)?Math.max(0,n).toFixed(2):'0';
const tooltipValue=n=>Number.isFinite(n)?n.toFixed(1)+'%':'—';

export function prepareHeatmap(prices,{level='Borong',state='',period=7,limit=120}={}){
  if(!Array.isArray(prices)||!VALID_LEVELS.includes(level)||
    !VALID_PERIODS.includes(Number(period))||typeof state!=='string')return {groups:[],total:0,shown:0,excluded:0};
  let available=0;
  const candidates=[];
  for(const quote of prices){
    if(quote?.level!==level||quote.state!==state)continue;
    available++;
    // The same market, grade, unit and price level must be comparable.
    const evidence=comparisonEvidence(quote,Number(period),quote.date);
    if(!evidence)continue;
    candidates.push({
      key:quote.product_key,name:quote.varieti,grade:quote.gred||'未分级',
      unit:quote.unit,category:String(quote.kategori||'未分类').trim()||'未分类',
      percent:evidence.percent,level,region:state,evidence,
      markets:evidence.markets,previousMean:evidence.previousMean,
      currentMean:evidence.currentMean,previousDate:evidence.previousDate,
      currentDate:evidence.currentDate,actualDays:evidence.actualDays,
      // Area represents the true number of matched markets (not market value).
      weight:evidence.markets
    });
  }
  candidates.sort((a,b)=>b.markets-a.markets||
    Math.abs(b.percent)-Math.abs(a.percent)||a.name.localeCompare(b.name));
  const tiles=candidates.slice(0,Math.max(1,Math.min(250,Number(limit)||120)));
  const groupsByName=new Map();
  for(const tile of tiles){
    if(!groupsByName.has(tile.category))
      groupsByName.set(tile.category,{name:tile.category,weight:0,items:[]});
    const group=groupsByName.get(tile.category);
    group.items.push(tile);group.weight+=tile.weight;
  }
  const groups=[...groupsByName.values()].sort((a,b)=>b.weight-a.weight||
    a.name.localeCompare(b.name));
  return {groups,tiles,total:candidates.length,shown:tiles.length,
    excluded:available-candidates.length};
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

export function heatmapColor(percent){
  if(!Number.isFinite(percent)||Math.abs(percent)<0.05)return '#3b4b4c';
  const intensity=Math.min(1,Math.log1p(Math.abs(percent))/Math.log1p(30));
  const light=round(25+17*intensity);
  return percent>0?'hsl(153 80% '+light+'%)':'hsl(355 79% '+light+'%)';
}

export function createMarketHeatmap({loadSnapshot,showComparison,notify}){
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
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if(w<100||h<100)return;
    const filter=state();
    const result=prepareHeatmap(snapshot.prices,{
      level:filter.level,state:filter.region,period:filter.period,
      limit:w<700?75:130
    });
    tiles=result.tiles||[];
    const label=filter.period===1?'昨日':filter.period+' 天';
    summary.textContent=snapshot.survey_date+' · '+filter.level+' · '+
      (filter.region||'全国')+' · '+label+'可比：'+result.shown+' / '+result.total+
      ' 项'+(result.excluded?' · '+result.excluded+' 项样本不足未上色':'');
    dateValue.textContent=snapshot.survey_date;
    if(!result.groups.length){
      canvas.innerHTML='<div class="market-heatmap-empty">当前筛选没有满足同市场样本门槛的涨跌数据。<span>可切换价格层级、地区或比较周期。</span></div>';
      detail.textContent='只显示有真实 FAMA 同市场对比依据的数据。';return;
    }
    const groupRects=treemapLayout(result.groups,w,h);
    let tileIndex=0;
    let markup='';
    for(const r of groupRects){
      const group=r.item;
      if(r.w<1||r.h<1)continue;
      const showHeader=r.h>=52&&r.w>=100;
      const head=showHeader?24:0;
      const innerW=Math.max(0,r.w-4),innerH=Math.max(0,r.h-head-4);
      const itemRects=treemapLayout(group.items,innerW,innerH);
      const cells=itemRects.map(tileRect=>{
        const item=tileRect.item;
        const idx=tileIndex++;
        tiles[idx]=item;
        const huge=tileRect.w>=132&&tileRect.h>=99;
        const medium=tileRect.w>=77&&tileRect.h>=62;
        const tiny=tileRect.w<58||tileRect.h<37;
        const value=(item.percent>0?'+':'')+tooltipValue(item.percent);
        const label=item.name+' · '+item.grade+' · '+filter.level+
          ' · '+value+' · '+item.markets+' 个共同市场';
        const inner='<span class="market-hm-name">'+escapeHtml(item.name)+'</span>'+
          (tiny?'':'<strong class="market-hm-change">'+escapeHtml(value)+'</strong>')+
          (huge?'<small>'+escapeHtml(item.grade)+'</small>':'');
        return '<button type="button" class="market-hm-cell'+
          (huge?' large':medium?' medium':tiny?' tiny':'')+
          '" data-market-hm-index="'+idx+
          '" title="'+escapeHtml(label)+'" aria-label="'+escapeHtml(label)+
          '" style="'+rectStyle(tileRect)+';background:'+heatmapColor(item.percent)+'">'+inner+'</button>';
      }).join('');
      markup+='<div class="market-hm-group" style="'+rectStyle(r)+'" title="'+escapeHtml(group.name)+'">'+
        (showHeader?'<div class="market-hm-group-header"><strong>'+escapeHtml(group.name)+
        '</strong><span>'+group.items.length+' 项</span></div>':'')+
        '<div class="market-hm-group-body" style="top:'+head+'px">'+cells+'</div></div>';
    }
    canvas.innerHTML=markup;
    detail.textContent='悬停查看同市场均价，点击色块核对该调查日的逐市场报价。面积表示共同调查市场数量。';
  };
  const showDetail=event=>{
    const btn=event.target.closest('[data-market-hm-index]');
    if(!btn||!canvas.contains(btn))return;
    const tile=tiles[Number(btn.dataset.marketHmIndex)];
    if(!tile)return;
    const dir=tile.percent>0?'上涨':tile.percent<0?'下跌':'持平';
    detail.textContent=tile.name+' · '+tile.grade+' | '+tile.level+' · '+
      (tile.region||'全国')+' | '+tile.previousDate+' → '+tile.currentDate+
      '（实际 '+tile.actualDays+' 天） | 同市场平均 '+
      fmtMoney(tile.previousMean)+' / '+tile.unit+' → '+fmtMoney(tile.currentMean)+' / '+tile.unit+
      ' | '+dir+' '+Math.abs(tile.percent).toFixed(1)+'% | '+tile.markets+' 个共同市场'+
      (Math.abs(tile.percent)>=50?' · ⚠ 大幅波动，建议核实原始报价':'');
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
        if(tile)showComparison(tile.evidence);
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
    selector.replaceChildren(new Option('全国平均',''));
    for(const region of overview.states)selector.add(new Option(region,region));
    selector.value=overview.states.includes(before)?before:'';
    snapshot=overview;status.textContent='已核对：'+overview.survey_date;
    status.dataset.loading='false';paint();
  };
  return {bind,refresh,paint,stop};
}
