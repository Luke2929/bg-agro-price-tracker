/* V3.4 Creator Workspace — pure data transforms; zero external services. */
import {quoteChange,PRICE_LEVELS} from './engine.mjs';

export const WORKSPACE_SCHEMA='bg-agro/creator-v34/1';
export const WORKSPACE_KEY='bg-agro-v34-creator-workspace';
export const WORKFLOW_STATES=['idea','draft','scheduled','published'];
export const POST_CHANNELS=['facebook','tiktok','whatsapp'];
export const FORMATS=['discussion','story','analysis','video'];
export const LANGUAGES=['bm','zh','both'];
const MAX_RECORDS=1000;
const MAX_TEXT=10000;
const MIN_COVERAGE=0.5;

function bounded(value,max=MAX_TEXT){
  return String(value??'').slice(0,max);
}
function compareDate(a,b){
  return String(a||'').localeCompare(String(b||''));
}
function safePct(value){return Number.isFinite(value)?value:0;}
export function formatPercent(percent){
  return (percent>0?'+':'')+percent.toFixed(1)+'%';
}
export function isValidISODate(day){
  if(typeof day!=='string'||!(/^\d{4}-\d{2}-\d{2}$/).test(day))return false;
  const timestamp=Date.parse(day+'T00:00:00Z');
  return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===day;
}
export function clampMetric(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>=0 ? Math.min(Math.round(n),1000000000):0;
}
export function normalizeMetrics(metrics={}){
  return Object.fromEntries(['reach','likes','comments','shares','messages','joins','orders']
    .map(key=>[key,clampMetric(metrics?.[key])]));
}

// Scoring formula is transparent and deterministic; never a predicted viral score.
export function scoreOpportunity(quote,context={}) {
  const change=quoteChange(quote,context.period||7);
  if(!change)return null;
  const move=Math.abs(change.percent);
  const coverage=Math.min(
    Number(change.currentCoverage??0),
    Number(change.previousCoverage??0)
  );
  const shared=Number(change.markets??0);
  const movement=Math.round(Math.min(30,move*3));
  const confidence=Math.round(Math.min(15,Math.max(0,shared)*2)+
    Math.max(0,Math.min(1,coverage))*15);
  const relevance=context.region?20:10;
  const discussion=Number(context.alignCount||0)>=3?20:
    context.divergent?18:Math.min(16,8+Math.floor(move/3));
  return {
    total:movement+confidence+relevance+discussion,
    components:{movement,confidence,relevance,discussion}
  };
}

function quoteId(quote,period){
  return [quote.product_key,quote.level,quote.state,String(period)].join('\u001f');
}

// Never combine L/B/R means. One scored story per eligible product+scope; the
// strongest eligible level nominates the topic while retaining the other levels.
export function findContentSignals(prices,{period=7,region='',category='',query='',type='all'}={}){
  const p=[1,7,30].includes(Number(period))?Number(period):7;
  const candidates=(Array.isArray(prices)?prices:[]).filter(q=>
    (q.state||'')===region&&(!category||q.kategori===category)&&
    (!query||[q.varieti,q.gred,q.unit].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))&&
    quoteChange(q,p));
  const byProduct=new Map();
  for(const q of candidates){
    const product=q.product_key||[q.varieti,q.gred,q.unit].join('||');
    if(!byProduct.has(product))byProduct.set(product,[]);
    byProduct.get(product).push(q);
  }
  const results=[];
  for(const [productKey,quotes] of byProduct){
    const valid=quotes.filter(q=>Math.abs(quoteChange(q,p).percent)<50);
    const outliers=quotes.filter(q=>Math.abs(quoteChange(q,p).percent)>=50);
    const allLevels=PRICE_LEVELS.every(l=>valid.some(q=>q.level===l));
    const signs=valid.map(q=>Math.sign(quoteChange(q,p).percent));
    const aligned=allLevels&&signs.length>=3&&signs.every(x=>x>0)||allLevels&&signs.length>=3&&signs.every(x=>x<0);
    const divergent=signs.some(x=>x>0)&&signs.some(x=>x<0);
    const riskOnly=!valid.length;
    const leader=[...(riskOnly?outliers:valid)].sort(
      (a,b)=>Math.abs(quoteChange(b,p).percent)-Math.abs(quoteChange(a,p).percent)
    )[0];
    if(!leader)continue;
    const change=quoteChange(leader,p);
    const risk=outliers.length>0;
    const score=scoreOpportunity(leader,{
      period:p,region,alignCount:aligned?3:0,divergent
    });
    const item={
      id:quoteId(leader,p),productKey,product:leader.varieti,
      grade:leader.gred||'',unit:leader.unit||'',category:leader.kategori||'',
      level:leader.level,region:region||'',period:p,percent:change.percent,
      markets:change.markets,currentCoverage:change.currentCoverage,
      previousCoverage:change.previousCoverage,
      currentDate:change.currentDate||leader.date||'',
      previousDate:change.previousDate||'',
      currentMean:change.current,previousMean:change.previous,
      aligned,divergent,flagged:risk,
      publishable:!riskOnly&&Math.abs(change.percent)<50,
      score:score?.total||0,components:score?.components||null,
      levels:valid.map(q=>({
        level:q.level,percent:quoteChange(q,p).percent,
        markets:quoteChange(q,p).markets
      }))
    };
    if(type==='rise'&&!(item.percent>0&&item.publishable))continue;
    if(type==='fall'&&!(item.percent<0&&item.publishable))continue;
    if(type==='aligned'&&!aligned)continue;
    if(type==='divergent'&&!divergent)continue;
    if(type==='audit'&&!risk)continue;
    if(type==='all'&&!item.publishable&&!item.flagged)continue;
    results.push(item);
  }
  return results.sort((a,b)=>{
    if(a.publishable!==b.publishable)return a.publishable?-1:1;
    return b.score-a.score||Math.abs(b.percent)-Math.abs(a.percent)||
      a.product.localeCompare(b.product);
  });
}

const LANG={
  bm:{up:'NAIK',down:'TURUN',farm:'ladang',wholesale:'borong',retail:'runcit'},
  zh:{up:'上涨',down:'下跌',farm:'农场',wholesale:'批发',retail:'零售'}
};
function levelsName(level,lang){
  if(lang==='zh')return ({Ladang:'农场',Borong:'批发',Runcit:'零售'})[level]||level;
  return ({Ladang:'ladang',Borong:'borong',Runcit:'runcit'})[level]||level;
}
function hashtags(signal,lang){
  const type=signal.product.toUpperCase().replace(/[^A-Z0-9]+/g,'');
  if(lang==='zh')return '#马来西亚农业 #FAMA #农产品价格 #SkyAgro';
  return '#HargaPertanian #PetaniMalaysia #FAMA #SkyAgro'+(type?' #'+type:'');
}

// A real editorial draft, not AI-generated prose. Every numerical claim comes
// only from immutable matched-market evidence. No fabricated farmer stories.
export function composeCreatorDraft(signal,{language='bm',format='discussion',channel='facebook'}={}){
  if(!signal||!signal.publishable||Math.abs(signal.percent)>=50)
    throw Error('此选题缺少可发布的合格数据，请先核实。');
  if(!LANGUAGES.includes(language)||!FORMATS.includes(format)||!POST_CHANNELS.includes(channel))
    throw Error('不支持的内容格式或语言');
  const percent=formatPercent(signal.percent),day=signal.currentDate,old=signal.previousDate,
    place=signal.region||'Malaysia',levelBM=levelsName(signal.level,'bm'),
    levelZH=levelsName(signal.level,'zh');
  if(!isValidISODate(day)||!isValidISODate(old)||!Number.isInteger(signal.markets)||signal.markets<3)
    throw Error('缺少可核实的 FAMA 比较日期或共同市场数，不能生成结论。');
  const bmTitle='HARGA '+signal.product+' '+(signal.percent>0?'NAIK ':'TURUN ')+percent+' — PETANI NAMPAK TAK?';
  const zhTitle=signal.product+' '+levelZH+'价格'+(signal.percent>0?'上涨':'下跌')+percent+'，农民怎么看？';
  const bmEvidence='Saya semak rekod tinjauan FAMA untuk '+day+' berbanding '+old+
    '. Bagi '+signal.product+' ('+signal.grade+' / '+signal.unit+'), harga purata '+
    levelBM+' di '+place+' berubah '+percent+' berdasarkan '+signal.markets+
    ' pasaran yang sama pada dua tarikh tersebut.';
  const zhEvidence='我整理了 FAMA 在 '+day+' 与 '+old+' 的市场调查数据。'+
    signal.product+'（'+signal.grade+' / '+signal.unit+'）在'+
    (signal.region||'全马')+'的'+levelZH+'层级，'+signal.markets+
    ' 个共同调查市场的价格变化为 '+percent+'。';
  const bmQuestion='Di kebun atau pasar kawasan anda, harga betul-betul macam ni ke? '+
    'Kos benih, baja, pekerja dan pengangkutan masih terkawal? Kongsi pengalaman sebenar di komen.';
  const zhQuestion='你那边的实际收购价也有这种变化吗？肥料、人工和运输成本有什么变化？欢迎分享真实情况。';
  const bmNote='Sumber: FAMA AMI | Tarikh: '+day+' | Rujukan: '+old+
    ' | '+signal.markets+' pasaran sepadan. Tinjauan bukan tawaran jual beli, '+
    'dan perubahan harga tidak membuktikan untung atau punca perubahan.';
  const zhNote='来源：FAMA AMI｜调查日：'+day+'｜比较基准：'+old+
    '｜共同市场：'+signal.markets+'。调查均价不等于成交价，也不能证明利润或涨跌原因。';
  const bmFormats={
    discussion:[bmTitle,bmEvidence,bmQuestion,bmNote].join('\n\n'),
    story:['Orang kebun selalu cerita, harga sayur ni kadang naik kadang turun.',
      'Saya tak nak agak-agak, jadi saya semak data FAMA dulu.',bmEvidence,
      'Angka ni bukan bermakna semua petani dapat harga sama.',bmQuestion,bmNote].join('\n\n'),
    analysis:['SEMAKAN HARGA PERTANIAN — '+signal.product,
      bmEvidence,'Penting: perbandingan dibuat pada pasaran yang sama, '+
      'bukan purata semua lokasi yang berbeza.',bmQuestion,bmNote].join('\n\n'),
    video:['HOOK (0–3s): '+bmTitle,
      'VOICEOVER: '+bmEvidence,
      'VISUAL: Paparkan harga dan peringkat '+levelBM+'.',
      'SOALAN PENONTON: '+bmQuestion,
      'CAPTION: '+bmNote].join('\n\n')
  };
  const zhFormats={
    discussion:[zhTitle,zhEvidence,zhQuestion,zhNote].join('\n\n'),
    story:['最近整理农产品价格时，我发现一个值得农友讨论的变化。',
      zhEvidence,'这并不代表每个农场都拿到一样的价格。',zhQuestion,zhNote].join('\n\n'),
    analysis:['农价观察｜'+signal.product,zhEvidence,
      '说明：比较采用同一批市场的报价，而不是不同地区均价简单相减。',
      zhQuestion,zhNote].join('\n\n'),
    video:['开场（0–3 秒）：'+zhTitle,'解说：'+zhEvidence,
      '画面：显示'+levelZH+'价格层级与两个真实调查日。',
      '互动问题：'+zhQuestion,'说明：'+zhNote].join('\n\n')
  };
  let body=language==='bm'?bmFormats[format]:language==='zh'?zhFormats[format]:
    bmFormats[format]+'\n\n—— 中文 ——\n\n'+zhFormats[format];
  if(channel==='tiktok')body+='\n\n'+
    (language==='zh'?hashtags(signal,'zh'):hashtags(signal,'bm'));
  else if(channel==='facebook')body+='\n\n'+
    (language==='zh'?hashtags(signal,'zh'):hashtags(signal,'bm'))+
    (language==='both'?' '+hashtags(signal,'zh'):'');
  return {
    title:language==='zh'?zhTitle:bmTitle,
    body,language,format,channel,
    evidence:signal,
    evidenceDate:day,createdFrom:'fama-matched-market'
  };
}

export function observedStreak(history,{level='Borong',state='',endDate}={}){
  // Different surveyed markets may occur on different dates: this is only
  // an observed-mean sequence, *not* a matched-market price-change claim.
  const points=(history?.observations||[]).filter(p=>p.level===level&&
    (p.state||'')===state&&(!endDate||p.date<=endDate)&&
    Number.isFinite(p.price)&&p.price>0)
    .sort((a,b)=>compareDate(a.date,b.date));
  if(points.length<3)return {direction:'none',count:0,points:points.slice(-4)};
  const last=points.slice(-5);
  let sign=0,count=0;
  for(let i=last.length-1;i>=1;i--){
    const diff=last[i].price-last[i-1].price;
    const current=Math.sign(diff);
    if(current===0)break;
    if(!sign)sign=current;
    if(sign!==current)break;
    count++;
  }
  return {direction:sign>0?'rise':sign<0?'fall':'none',count,
    points:last,warning:'不同调查日可能使用不同市场；不代表同市场连续涨跌。'};
}

export function emptyWorkspace(){
  return {schema:WORKSPACE_SCHEMA,records:[]};
}
function validatedRecord(r){
  if(!r||typeof r!=='object'||Array.isArray(r))throw Error('内容记录结构不正确');
  if(!r.id||typeof r.id!=='string'||r.id.length>120)throw Error('内容记录 ID 无效');
  if(!WORKFLOW_STATES.includes(r.status))throw Error('内容状态无效');
  if(!POST_CHANNELS.includes(r.channel))throw Error('发布平台无效');
  const scheduled=r.scheduledDate||'';
  if(scheduled&&!isValidISODate(scheduled))throw Error('排期日期无效');
  const url=bounded(r.postUrl,1200).trim();
  if(url&&!/^https:\/\/[^\s]+$/i.test(url))throw Error('发布链接须为 HTTPS');
  const evidence=r.evidence&&typeof r.evidence==='object'?r.evidence:null;
  return {
    id:r.id,createdAt:bounded(r.createdAt,50),updatedAt:bounded(r.updatedAt,50),
    status:r.status,channel:r.channel,
    language:LANGUAGES.includes(r.language)?r.language:'bm',
    format:FORMATS.includes(r.format)?r.format:'discussion',
    title:bounded(r.title,300),body:bounded(r.body),
    scheduledDate:scheduled,postedDate:isValidISODate(r.postedDate)?r.postedDate:'',
    postUrl:url,notes:bounded(r.notes,2000),
    metrics:normalizeMetrics(r.metrics),evidence,
    evidenceDate:bounded(r.evidenceDate,12)
  };
}
export function readWorkspace(text){
  if(!text)return emptyWorkspace();
  const raw=typeof text==='string'?JSON.parse(text):text;
  if(!raw||raw.schema!==WORKSPACE_SCHEMA||!Array.isArray(raw.records)||
    raw.records.length>MAX_RECORDS)throw Error('不是受支持的 V3.4 内容备份格式');
  const records=raw.records.map(validatedRecord);
  if(new Set(records.map(x=>x.id)).size!==records.length)throw Error('备份存在重复 ID');
  return {schema:WORKSPACE_SCHEMA,records};
}
export function saveRecord(workspace,record){
  const current=readWorkspace(workspace);
  const next=validatedRecord(record);
  const existing=current.records.findIndex(x=>x.id===next.id);
  if(existing<0){
    if(current.records.length>=MAX_RECORDS)throw Error('已达到 1000 篇上限，请先备份');
    current.records.unshift(next);
  }else current.records[existing]=next;
  return current;
}
export function contentMetrics(workspace){
  const docs=readWorkspace(workspace).records;
  const totals={records:docs.length,drafts:0,scheduled:0,published:0,
    reach:0,likes:0,comments:0,shares:0,messages:0,joins:0,orders:0};
  for(const x of docs){
    if(x.status==='published')totals.published++;
    if(x.status==='scheduled')totals.scheduled++;
    if(['draft','idea'].includes(x.status))totals.drafts++;
    if(x.status!=='published')continue;
    for(const key of ['reach','likes','comments','shares','messages','joins','orders'])
      totals[key]+=x.metrics[key]||0;
  }
  return totals;
}
export function toCSV(workspace){
  const records=readWorkspace(workspace).records;
  const fields=['id','title','status','channel','scheduledDate','postedDate','postUrl',
    'evidenceDate','reach','likes','comments','shares','messages','joins','orders'];
  const escape=value=>'"'+String(value??'').replace(/"/g,'""').replace(/[\r\n]+/g,' ')+'"';
  const rows=records.map(r=>fields.map(key=>escape(key in r.metrics?r.metrics[key]:r[key])).join(','));
  return fields.map(escape).join(',')+'\r\n'+rows.join('\r\n')+(rows.length?'\r\n':'');
}
