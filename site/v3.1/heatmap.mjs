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

export function createMarketHeatmap({loadSnapshot,showComparison,showProductHistory,showPreview,notify}){
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
  const searchEl=$('market-heatmap-search'),categoryEl=$('market-heatmap-category');
  const sortEl=$('market-heatmap-sort'),lockEl=$('market-heatmap-lock');
  const stateEl=$('market-heatmap-state'),backEl=$('market-heatmap-back-all');
  const modeEl=$('market-heatmap-mode'),captureEl=$('market-heatmap-capture');
  let dates=[],snapshot=null,selection=0,token=0,playing=false,playTimer=null,tiles=[];
  let observer=null,lockedKeys=null;

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
    region:stateEl.value,
    period:Number($('market-heatmap-period').value),
    search:searchEl.value,category:categoryEl.value,sort:sortEl.value
  });
  const resetLayout=()=>{lockedKeys=null};
  const keyFor=t=>[t.region,t.key,t.level].join('\u001F');
  const applyLockedLayout=result=>{
    if(!lockEl.checked)return result;
    if(!lockedKeys)lockedKeys=result.groups.map(group=>({
      name:group.name,items:group.items.map(item=>({...item,lockKey:keyFor(item)}))
    }));
    const lookup=new Map(result.tiles.map(tile=>[keyFor(tile),tile]));
    const current=new Map(result.groups.map(group=>[group.name,group]));
    const groups=lockedKeys.map(g=>{
      const currentGroup=current.get(g.name);
      return {...(currentGroup||{name:g.name,weight:1,observed:0,strict:0,smallSample:0}),
        items:g.items.map(baseline=>lookup.get(baseline.lockKey)||
          {...baseline,missing:true,evidence:null,percent:null,quality:'missing',price:null})};
    });
    return {...result,groups,tiles:groups.flatMap(g=>g.items)};
  };
  const rectStyle=(r)=>'left:'+position(r.x)+'px;top:'+position(r.y)+
    'px;width:'+position(r.w)+'px;height:'+position(r.h)+'px';
  const tileHTML=(item,idx,{box='',single=false}={})=>{
    tiles[idx]=item;
    const missing=Boolean(item.missing);
    const percent=item.percent;
    const neutral=item.evidence&&Math.abs(percent)<.05;
    const value=missing?'无报价':item.evidence?
      (percent>0?'+':'')+tooltipValue(percent):'N/A';
    const current=Number.isFinite(item.price)?fmtMoney(item.price):'—';
    const quality=missing?'无当日报价':item.quality==='strict'?'严格同市场对比':
      item.quality==='small-sample'?'小样本同市场对比，仅代表对应市场':'当日报价，无历史可比数据';
    const title=[item.region||'全国',item.name,item.grade,item.level,
      value,item.evidence?item.markets+' 个共同市场':current+' / '+item.unit,quality].join(' · ');
    const klass=missing?' missing':neutral?' neutral':item.quality==='small-sample'?
      ' small-sample':item.evidence?'':' uncomparable';
    const content='<span class="market-hm-name">'+escapeHtml(item.name)+'</span>'+
      '<strong class="market-hm-change">'+escapeHtml(value)+'</strong>'+
      (single?'<small>'+escapeHtml(missing?'当日无价':current+' / '+item.unit)+
        ' · '+escapeHtml(item.grade)+'</small>':'');
    const style=box?box+';':'';
    return '<button type="button" class="market-hm-cell'+klass+
      (single?' market-hm-product-card':'')+'" data-market-hm-index="'+idx+
      '" title="'+escapeHtml(title)+'" aria-label="'+escapeHtml(title)+
      '"'+(missing?' disabled':'')+' style="'+style+'background:'+heatmapColor(percent,item.quality)+
      '">'+content+'</button>';
  };
  const paint=()=>{
    if(!snapshot)return;
    const filter=state(),allStates=filter.region===ALL_STATES,selectedState=Boolean(filter.region)&&!allStates;
    const w=canvas.clientWidth;
    if(w<100)return;
    canvas.classList.toggle('all-states',allStates);
    canvas.classList.toggle('single-state',selectedState);
    const columns=w>=1040?4:w>=720?3:2;
    const rows=Math.ceil(MALAYSIA_STATES.length/columns);
    canvas.style.height=allStates?String(rows*(w<550?244:252))+'px':selectedState?'auto':'';
    const h=canvas.clientHeight;
    if(h<100&&!selectedState)return;
    const rawResult=prepareHeatmap(snapshot.prices,{
      ...filter,limit:w<700?75:130
    });
    const result=applyLockedLayout(rawResult);
    tiles=[];
    const periodName=filter.period===1?'1 日':filter.period+' 日';
    const regionLabel=allStates?'全马 16 州／直辖区':filter.region||'全国均价';
    summary.textContent=allStates?
      snapshot.survey_date+' · '+filter.level+' · '+regionLabel+' · 报价覆盖 '+
      rawResult.coverage+'/16 · 严格比较 '+rawResult.strict+' · 小样本 '+rawResult.smallSample+
      ' · 当前显示 '+rawResult.shown+' / '+rawResult.total+' 项（点击州标题查看全部）':
      snapshot.survey_date+' · '+filter.level+' · '+regionLabel+' · '+periodName+
      '比较：严格 '+rawResult.strict+'、小样本 '+rawResult.smallSample+
      ' · 显示 '+rawResult.shown+' / '+rawResult.total+' 个产品';
    dateValue.textContent=snapshot.survey_date;
    backEl.hidden=allStates;
    modeEl.textContent=allStates?'全马概览 · 点击州标题展开全部产品':
      selectedState?filter.region+' · 全部符合筛选条件的产品':'全国平均 · 按农产品类别';
    if(!result.groups.length||(!result.tiles.length&&!allStates)){
      canvas.innerHTML='<div class="market-heatmap-empty">当前筛选没有可显示的实际报价。<span>尝试清除搜索或调整价格层级、日期和分类。</span></div>';
      detail.textContent='没有替换成别州或其他日期的数据。';return;
    }
    let markup='',index=0;
    if(selectedState){
      // Responsive full-list mode: all matching items, no hard-coded first N cap.
      for(const group of result.groups){
        markup+='<section class="market-hm-single-category"><h3>'+
          escapeHtml(group.name)+' <span>'+group.items.length+' 项</span></h3>'+
          '<div class="market-hm-single-cards">';
        for(const item of group.items)markup+=tileHTML(item,index++,{single:true});
        markup+='</div></section>';
      }
    }else{
      const rects=allStates?result.groups.map((group,i)=>({
        item:group,x:(i%columns)*w/columns,y:Math.floor(i/columns)*h/rows,
        w:w/columns,h:h/rows
      })):treemapLayout(result.groups,w,h);
      for(const r of rects){
        const group=r.item;
        const head=allStates?32:r.h>=52&&r.w>=100?24:0;
        const innerW=Math.max(0,r.w-4),innerH=Math.max(0,r.h-head-4);
        const itemRects=allStates?group.items.map((item,i)=>({
          item,x:(i%2)*innerW/2,
          y:Math.floor(i/2)*innerH/Math.max(1,Math.ceil(group.items.length/2)),
          w:innerW/2,h:innerH/Math.max(1,Math.ceil(group.items.length/2))
        })):treemapLayout(group.items,innerW,innerH);
        const cells=itemRects.map(t=>tileHTML(t.item,index++,{
          box:rectStyle(t)
        })).join('');
        const more=allStates?Math.max(0,group.observed-group.items.length):0;
        const caption=allStates?(group.totalActual?
          group.items.length+'/'+group.observed+' 项 · '+group.strict+' 严格 / '+
          group.smallSample+' 小样本'+(more?' · +'+more:''):'当日无此层级报价'):
          group.items.length+' 项';
        const header=allStates?'<button type="button" class="market-hm-open-state" data-hm-state="'+
          escapeHtml(group.name)+'" aria-label="查看 '+escapeHtml(group.name)+
          ' 的全部农产品">'+escapeHtml(group.name)+' <span>展开 ↗</span></button>':
          '<strong>'+escapeHtml(group.name)+'</strong>';
        const placeholder=allStates&&!group.items.length?
          '<div class="market-hm-no-data">'+
          (group.totalActual?'当前筛选没有匹配产品':'该调查日没有此层级报价')+'</div>':'';
        markup+='<div class="market-hm-group'+(allStates?' market-hm-state':'')+
          '" style="'+rectStyle(r)+'">'+
          (head?'<div class="market-hm-group-header">'+header+
            '<span title="'+escapeHtml(caption)+'">'+escapeHtml(caption)+'</span></div>':'')+
          '<div class="market-hm-group-body" style="top:'+head+'px">'+cells+
          placeholder+'</div></div>';
      }
    }
    canvas.innerHTML=markup;
    detail.textContent=allStates?'点击州标题查看全部农产品；点击产品查看当前调查日的真实价格及历史记录。':
      '点击产品打开历史价格详情；虚线 / * 表示小样本，0.0% 与 N/A 含义不同。';
  };
  const showDetail=event=>{
    const btn=event.target.closest('[data-market-hm-index]');
    if(!btn||!canvas.contains(btn))return;
    const item=tiles[Number(btn.dataset.marketHmIndex)];
    if(!item)return;
    if(!item.evidence){
      detail.textContent=item.missing?'该产品在 '+snapshot.survey_date+' 没有真实报价；没有沿用旧价。':
        item.region+' · '+item.name+' · '+item.grade+' · '+item.level+
        ' | '+item.currentDate+' 均价 '+fmtMoney(item.price)+' / '+item.unit+
        ' · '+item.surveyedMarkets+' 个调查市场；没有可核查的同市场历史比较。';
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
  const capturePNG=()=>{
    try{
      const area=canvas.getBoundingClientRect();
      if(!area.width||!area.height)throw Error('热力图尚未生成');
      const ratio=2,pad=26,heading=74;
      const out=document.createElement('canvas');
      out.width=Math.round((area.width+pad*2)*ratio);
      out.height=Math.round((area.height+pad*2+heading)*ratio);
      const ctx=out.getContext('2d');
      if(!ctx)throw Error('浏览器不支持 Canvas');
      ctx.scale(ratio,ratio);
      ctx.fillStyle='#081616';ctx.fillRect(0,0,out.width/ratio,out.height/ratio);
      ctx.textBaseline='middle';ctx.fillStyle='#f5fff8';ctx.font='bold 19px sans-serif';
      ctx.fillText('BG AGRO · 农产品价格 Heatmap',pad,29);
      ctx.fillStyle='#a8d8bf';ctx.font='11px sans-serif';
      ctx.fillText(snapshot.survey_date+' · '+state().region+' · '+
        state().level+' · '+state().period+' 天涨跌 | 数据来源 FAMA AMI',pad,56);
      const ox=pad,oy=heading+pad;
      for(const group of canvas.querySelectorAll('.market-hm-group,.market-hm-single-category')){
        const r=group.getBoundingClientRect();
        ctx.fillStyle='#102925';ctx.fillRect(ox+r.left-area.left,oy+r.top-area.top,r.width,r.height);
      }
      for(const cell of canvas.querySelectorAll('.market-hm-cell')){
        const r=cell.getBoundingClientRect();
        if(r.width<=0||r.height<=0)continue;
        const x=ox+r.left-area.left,y=oy+r.top-area.top;
        ctx.fillStyle=getComputedStyle(cell).backgroundColor;
        ctx.fillRect(x+.6,y+.6,Math.max(0,r.width-1.2),Math.max(0,r.height-1.2));
        const index=Number(cell.dataset.marketHmIndex),item=tiles[index];
        if(!item)continue;
        ctx.fillStyle='#fff';ctx.textAlign='center';
        ctx.font='bold 10px sans-serif';
        const product=item.name.length>20?item.name.slice(0,18)+'…':item.name;
        ctx.fillText(product,x+r.width/2,y+r.height/2-8,Math.max(25,r.width-9));
        ctx.font='bold 12px sans-serif';
        const label=item.missing?'无报价':item.evidence?
          (item.percent>0?'+':'')+tooltipValue(item.percent):'N/A';
        ctx.fillText(label+(item.quality==='small-sample'?'*':''),x+r.width/2,
          y+r.height/2+10,Math.max(25,r.width-9));
        if(item.quality==='small-sample'){
          ctx.setLineDash([3,3]);ctx.strokeStyle='#f4fffe';
          ctx.strokeRect(x+1.5,y+1.5,r.width-3,r.height-3);ctx.setLineDash([]);
        }
      }
      for(const group of canvas.querySelectorAll('.market-hm-group-header,.market-hm-single-category>h3')){
        const r=group.getBoundingClientRect();
        ctx.fillStyle='#d9eee1';ctx.font='bold 11px sans-serif';ctx.textAlign='left';
        ctx.fillText(group.querySelector('strong,.market-hm-open-state')?.textContent||
          group.textContent.split('项')[0],ox+r.left-area.left+7,oy+r.top-area.top+12,
          Math.max(40,r.width-15));
      }
      ctx.fillStyle='#a9c6b6';ctx.font='10px sans-serif';ctx.textAlign='left';
      ctx.fillText('红跌绿涨｜虚线 * 小样本｜0% 持平｜N/A 无法比较',pad,
        out.height/ratio-12);
      out.toBlob(blob=>{
        if(!blob){notify('PNG 生成失败',true);return;}
        const url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download='BG_AGRO_Heatmap_'+snapshot.survey_date+'_'+
          (state().region||'NATIONAL')+'.png';
        document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1200);
      },'image/png');
    }catch(error){notify('Heatmap 图片导出失败：'+error.message,true);}
  };
  const bind=()=>{
    const changeFilters=()=>{stop();resetLayout();paint();};
    $('market-heatmap-period').addEventListener('change',changeFilters);
    for(const id of ['market-heatmap-state','market-heatmap-level','market-heatmap-category','market-heatmap-sort'])
      $(id).addEventListener('change',changeFilters);
    searchEl.addEventListener('input',changeFilters);
    lockEl.addEventListener('change',()=>{stop();resetLayout();paint();});
    backEl.addEventListener('click',()=>{stateEl.value=ALL_STATES;changeFilters();});
    captureEl.addEventListener('click',capturePNG);
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
      const stateButton=event.target.closest('[data-hm-state]');
      if(stateButton&&canvas.contains(stateButton)){
        stateEl.value=stateButton.dataset.hmState;
        stop();resetLayout();paint();return;
      }
      const btn=event.target.closest('[data-market-hm-index]');
      if(!btn||!canvas.contains(btn))return;
      const tile=tiles[Number(btn.dataset.marketHmIndex)];
      if(!tile||tile.missing)return;
      stop();
      if(typeof showPreview==='function')showPreview(tile,snapshot);
      else if(tile.region&&typeof showProductHistory==='function')
        showProductHistory(tile.key,tile.region,tile.level,snapshot.survey_date,snapshot);
      else if(tile.quality==='strict'&&tile.evidence)showComparison(tile.evidence);
      else showDetail({target:btn});
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
    const categories=[...new Set(overview.prices.map(q=>q.kategori).filter(Boolean))].sort();
    const priorCategory=categoryEl.value;
    categoryEl.replaceChildren(new Option('全部分类',''));
    for(const category of categories)categoryEl.add(new Option(category,category));
    categoryEl.value=categories.includes(priorCategory)?priorCategory:'';
    resetLayout();
    snapshot=overview;status.textContent='已核对：'+overview.survey_date;
    status.dataset.loading='false';paint();
  };
  return {bind,refresh,paint,stop};
}
