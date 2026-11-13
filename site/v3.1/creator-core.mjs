/* V3.4 Creator Workspace — pure data transforms; zero external services. */
import {comparisonEvidence,quoteChange,PRICE_LEVELS,productIdentity,isValidISODate} from './engine.mjs?rev=price-evidence-1';

export {isValidISODate};

export const WORKSPACE_SCHEMA='bg-agro/creator-v34/1';
export const WORKSPACE_KEY='bg-agro-v34-creator-workspace';
export const WORKFLOW_STATES=['idea','draft','scheduled','published'];
export const POST_CHANNELS=['facebook','tiktok','whatsapp'];
export const FORMATS=['discussion','casual','story','analysis','educational','community','video'];
export const LANGUAGES=['bm','zh','both'];
export const PROMOTION_OPTIONS=['mentionPage','inviteFollow','mentionWhatsApp','commentKeyword','networking'];
const MAX_RECORDS=1000;
const MAX_TEXT=10000;

function bounded(value,max=MAX_TEXT){
  return String(value??'').slice(0,max);
}
function compareDate(a,b){
  return String(a||'').localeCompare(String(b||''));
}
export function formatPercent(percent){
  if(!Number.isFinite(percent))return '—';
  if(Math.abs(percent)<0.05)return '0.0%';
  return (percent>0?'+':'')+percent.toFixed(1)+'%';
}

export function formatPrice(value,unit,{signed=false,precision=2}={}){
  if(!Number.isFinite(value))return '—';
  const amount=Math.abs(value).toLocaleString('en-MY',{
    minimumFractionDigits:2,maximumFractionDigits:precision
  });
  const hasValue=Number(amount.replaceAll(',',''))>0;
  const sign=hasValue?(value<0?'-':signed?'+':''):'';
  const displayUnit=unit==='Kilogram'?'kg':unit==='Biji'?'biji':unit;
  return sign+'RM'+amount+(displayUnit?'/'+displayUnit:'');
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
  return JSON.stringify([quote.date,quote.product_key,quote.level,quote.state,period]);
}

// Never combine L/B/R means. One scored story per eligible product+scope; the
// strongest eligible level nominates the topic while retaining the other levels.
export function findContentSignals(prices,{period=7,region='',category='',query='',type='all',level=''}={}){
  const p=[1,7,30].includes(Number(period))?Number(period):7;
  const candidates=(Array.isArray(prices)?prices:[]).filter(q=>
    q.state===region&&matchesTopic(q,category,query)&&comparisonEvidence(q,p));
  const byProduct=new Map();
  for(const q of candidates){
    const product=q.product_key;
    if(!byProduct.has(product))byProduct.set(product,[]);
    byProduct.get(product).push(q);
  }
  const results=[];
  for(const quotes of byProduct.values()){
    const valid=quotes.filter(q=>Math.abs(quoteChange(q,p).percent)<50);
    const outliers=quotes.filter(q=>Math.abs(quoteChange(q,p).percent)>=50);
    const allLevels=PRICE_LEVELS.every(l=>valid.some(q=>q.level===l));
    const signs=valid.map(q=>Math.sign(quoteChange(q,p).percent));
    const aligned=allLevels&&(signs.every(x=>x>0)||signs.every(x=>x<0));
    const divergent=signs.some(x=>x>0)&&signs.some(x=>x<0);
    const risk=outliers.length>0;
    const leaders=type==='audit'||!valid.length?outliers:valid.filter(q=>
      type==='rise'?quoteChange(q,p).percent>0:type==='fall'?quoteChange(q,p).percent<0:true);
    const leader=leaders.filter(q=>!level||q.level===level).sort(
      (a,b)=>Math.abs(quoteChange(b,p).percent)-Math.abs(quoteChange(a,p).percent)
    )[0];
    if(!leader)continue;
    const comparison=comparisonEvidence(leader,p);
    const score=scoreOpportunity(leader,{
      period:p,region,alignCount:aligned?3:0,divergent
    });
    const item={
      ...comparison,id:quoteId(leader,p),category:leader.kategori||'',
      aligned,divergent,flagged:risk,publishable:!risk,
      score:score?.total||0,components:score?.components||null,
      levels:valid.map(q=>comparisonEvidence(q,p))
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
    if(type==='rise')return b.percent-a.percent||b.score-a.score;
    if(type==='fall')return a.percent-b.percent||b.score-a.score;
    if(type==='audit')return Math.abs(b.percent)-Math.abs(a.percent);
    return b.score-a.score||Math.abs(b.percent)-Math.abs(a.percent)||
      a.product.localeCompare(b.product);
  });
}

export function matchesTopic(quote,category='',query=''){
  return (!category||quote.kategori===category)&&(!query||
    [quote.varieti,quote.gred,quote.unit].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
}

export function statePriceSpreads(prices,{region='',category='',query=''}={}){
  const groups=new Map();
  for(const quote of prices){
    if(!quote.state||quote.markets<3||!Number.isFinite(quote.price)||quote.price<0||
      !matchesTopic(quote,category,query))continue;
    const key=JSON.stringify([quote.product_key,quote.level,quote.date]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(quote);
  }
  const spreads=[];
  for(const quotes of groups.values()){
    if(quotes.length<2)continue;
    const sorted=quotes.sort((a,b)=>a.price-b.price||a.state.localeCompare(b.state));
    let low=sorted[0],high=sorted.at(-1);
    if(region){
      const local=sorted.find(quote=>quote.state===region);
      if(!local)continue;
      if(local.price-low.price>=high.price-local.price)high=local;
      else low=local;
    }
    const difference=high.price-low.price;
    if(difference>0)spreads.push({low,high,difference,relative:difference/high.price});
  }
  return spreads.sort((a,b)=>b.relative-a.relative||b.difference-a.difference);
}

const LEVEL_ZH={Ladang:'农场',Borong:'批发',Runcit:'零售'};
const DRAFT_SETTINGS={showSource:true,mentionPage:false,inviteFollow:false,
  mentionWhatsApp:false,commentKeyword:false,networking:false,confirmedConversation:false};

export function draftSettings(settings={}){
  return Object.fromEntries(Object.entries(DRAFT_SETTINGS).map(([key,value])=>
    [key,typeof settings?.[key]==='boolean'?settings[key]:value]));
}

export function evidenceForQuote(quote,period,prices=[quote],surveyDate=quote?.date){
  const comparison=comparisonEvidence(quote,period,surveyDate);
  if(!comparison)return null;
  const flagged=Math.abs(comparison.percent)>=50||prices.some(other=>other.product_key===quote.product_key&&other.state===quote.state&&
    Math.abs(quoteChange(other,period)?.percent)>=50);
  return {...comparison,id:quoteId(quote,period),source:'FAMA AMI',flagged,publishable:!flagged};
}

function checkedEvidence(signal){
  if(!signal?.publishable||signal.flagged||Math.abs(signal.percent)>=50)
    throw Error('此选题缺少可发布的合格数据，请先核实。');
  const quote={
    product_key:signal.productKey,varieti:signal.product,gred:signal.grade,unit:signal.unit,
    level:signal.level,state:signal.region,date:signal.currentDate,
    changes:{[signal.period]:{
      eligible:true,previous:signal.previousMean,current:signal.currentMean,
      rmDifference:signal.rmDifference,percent:signal.percent,markets:signal.markets,
      previousDate:signal.previousDate,currentDate:signal.currentDate,days:signal.period,
      actualDays:signal.actualDays,currentMarkets:signal.currentMarkets,previousMarkets:signal.previousMarkets,
      currentCoverage:signal.currentCoverage,previousCoverage:signal.previousCoverage
    }}
  };
  if(!comparisonEvidence(quote,signal.period))throw Error('价格比较数据不完整或不一致。');
  return signal;
}

function promotionParagraphs(settings,lang){
  const bm=lang==='bm';
  return [
    settings.confirmedConversation&&(bm?'Saya ada bincang angka ni dengan bos SKY AGRO.':'我有跟 SKY AGRO 老板聊过这组行情。'),
    settings.mentionPage&&(bm?'Kalau nak sembang pasal harga dan kebun, boleh singgah halaman SKY AGRO.':'想交流行情或种植经验，可以到 SKY AGRO 页面聊聊。'),
    settings.inviteFollow&&(bm?'Kalau berguna, boleh follow untuk tengok perkongsian harga seterusnya.':'觉得有用，可以关注，之后还有农价分享。'),
    settings.mentionWhatsApp&&(bm?'Kalau nak masuk komuniti pertanian WhatsApp, boleh mesej saya.':'想进农业 WhatsApp 群，可以私讯我。'),
    settings.commentKeyword&&(bm?'Kalau berminat, komen NAK.':'有兴趣可以留言 NAK。'),
    settings.networking&&(bm?'Orang kebun sekitar Pusing, Batu Gajah, Siputeh, Tronoh dan Gopeng, jom kenal-kenal.':'Pusing、Batu Gajah、Siputeh、Tronoh、Gopeng 附近的农友，欢迎互相认识。')
  ].filter(Boolean);
}

function template(signal,format,lang,settings){
  const bm=lang==='bm',level=bm?signal.level.toLowerCase():LEVEL_ZH[signal.level];
  const percent=formatPercent(signal.percent);
  const movement=signal.percent>0?(bm?'NAIK':'上涨'):signal.percent<0?(bm?'TURUN':'下跌'):(bm?'KEKAL':'持平');
  const title=bm?'HARGA '+signal.product+' '+movement+' '+percent+' · '+signal.level.toUpperCase():
    signal.product+' '+level+'价'+movement+' '+percent;
  const place=bm?(signal.region||'pasaran tinjauan seluruh Malaysia'):(signal.region||'全国调查样本');
  const previous=formatPrice(signal.previousMean,signal.unit),current=formatPrice(signal.currentMean,signal.unit);
  const difference=formatPrice(signal.rmDifference,signal.unit,{signed:true});
  const grade=signal.grade||(bm?'tiada gred direkodkan':'品级未记录');
  const interval=bm
    ? signal.currentDate+' berbanding '+signal.previousDate+' (selang '+signal.actualDays+' hari).'
    : signal.previousDate+' 至 '+signal.currentDate+'（相隔 '+signal.actualDays+' 天）。';
  const evidence=bm
    ? interval+' Purata harga '+level+' '+signal.product+' ('+grade+', '+signal.unit+') di '+place+
      ' bergerak daripada '+previous+' kepada '+current+'. Beza '+difference+' ('+percent+
      ') berdasarkan '+signal.markets+' pasaran yang sama.'
    : interval+place+'的 '+signal.product+'（'+grade+'，'+signal.unit+'）'+level+'均价从 '+previous+
      ' 到 '+current+'，价差 '+difference+'（'+percent+'），涵盖 '+signal.markets+' 个共同调查市场。';
  const question=bm?'Harga kat tempat korang macam mana? Kongsi kawasan dan harga yang korang nampak.':
    '你那边看到的是什么价？可以留言说说地点和实际报价。';
  const note=bm?'Harga di setiap kawasan boleh berbeza. Untung bergantung juga pada kos dan hasil jualan.':
    '各地报价可能不同。实际利润还取决于成本和售出的数量。';
  const method=bm?'Purata dikira daripada pasaran yang sama. Setiap pasaran diberi berat yang sama.':
    '比较使用两日都有报价的市场，各市场权重相同。';
  const text=(value,required=false)=>({value,required});
  const fact=text((format==='video'?(bm?'VOICEOVER: ':'解说：'):'')+evidence,true);
  const segments={
    analysis:[text(title),fact,text(method)],
    casual:[text(bm?'Harga sayur ni, lain tempat lain ceritanya. Tengok yang ni dulu.':'菜价每个地方都不一样，先看这组数字。'),fact,text(question)],
    discussion:[text(title),fact,text(question)],
    story:[
      text(bm?'Kadang-kadang masa harga tengah cantik, hasil pula tak banyak. Bila hasil banyak, harga pula jatuh. Memang pening kepala dibuatnya.':
        '行情好的时候，手上的菜可能不多。等菜多起来，又担心赶上价格回落。'),
      text(bm?'Dari petik hasil, asingkan ikut gred sampai hantar ke pasar, ada macam-macam kerja. Lepas tu baru sampai soalan yang orang kebun selalu kena fikir: harga hari ni cukup ke untuk tutup kos?':
        '从采收、分级到送到市场，中间还有不少活。农友算账时还要问，今天的售价够不够 cover 成本？'),
      text(bm?'Bila tengok satu angka je, susah nak tahu apa yang berubah. Jom tengok dua tarikh untuk sayur yang sama.':
        '只看一天的报价，很难知道价格怎么走。拿同一种菜的两个调查日来看看。'),
      fact,text(note),text(question)
    ],
    educational:[
      text(bm?'Ladang ialah harga di peringkat kebun. Borong ialah harga urus niaga borong. Runcit ialah harga di peringkat jualan kepada pengguna.':
        'Ladang 是农场端，Borong 是批发端，Runcit 是面向消费者的零售端。'),
      fact,text(method),text(note)
    ],
    community:[
      text(bm?'Kalau ada orang kebun atau peniaga kat sini, jom bandingkan dengan harga di tempat masing-masing.':
        '有种菜或卖菜的朋友，欢迎拿你那边的行情一起聊。'),fact,text(question)
    ],
    video:[
      text((bm?'HOOK (0–3s): ':'开场（0–3 秒）：')+title),fact,
      text(bm?'VISUAL: Paparkan harga dan peringkat '+level+'.':'画面：显示'+level+'层级、两日均价和调查日期。'),
      text((bm?'SOALAN PENONTON: ':'互动问题：')+question)
    ]
  }[format];
  if(format==='discussion')segments.push(text(note));
  segments.push(...promotionParagraphs(settings,lang).map(value=>text(value,true)));
  if(settings.showSource)segments.push(text(bm?'Sumber: FAMA AMI':'来源：FAMA AMI',true));
  return {title,segments};
}

function hashtags(signal,lang,settings){
  const product=signal.product.toUpperCase().replace(/[^A-Z0-9]+/g,'');
  return [
    lang==='zh'?'#马来西亚农业 #农产品价格':'#HargaPertanian #PetaniMalaysia',
    settings.showSource?'#FAMA':'',
    settings.mentionPage?'#SkyAgro':'',
    lang==='bm'&&product?'#'+product:''
  ].filter(Boolean).join(' ');
}

function draftTemplate(signal,{language='bm',format='discussion',channel='facebook',settings}={}){
  checkedEvidence(signal);
  if(!LANGUAGES.includes(language)||!FORMATS.includes(format)||!POST_CHANNELS.includes(channel))
    throw Error('不支持的内容格式或语言');
  settings=draftSettings(settings);
  const langs=language==='both'?['bm','zh']:[language];
  const translations=langs.map(lang=>template(signal,format,lang,settings));
  const segments=translations.flatMap(({segments},index)=>
    index?[{value:'—— 中文 ——',required:true},...segments]:segments);
  if(channel!=='whatsapp')segments.push({value:langs.map(lang=>hashtags(signal,lang,settings)).join(' ')});
  return {title:translations[0].title,segments,language,format,channel,settings};
}

export function composeCreatorDraft(signal,options){
  const {title,segments,language,format,channel,settings}=draftTemplate(signal,options);
  return {title,body:segments.map(segment=>segment.value).join('\n\n'),language,format,channel,settings,
    evidence:signal,evidenceDate:signal.currentDate,createdFrom:'fama-matched-market'};
}

const normalizeText=text=>String(text??'').trim().replace(/\s+/g,' ');

// Validate public copy against the current archive-backed template. Optional
// paragraphs may be removed; required facts and wording cannot be substituted.
export function validateCreatorDraft({title,body},signal,options){
  let expected;
  try{expected=draftTemplate(signal,options);}
  catch(error){return {valid:false,message:error.message};}
  if(normalizeText(title)!==normalizeText(expected.title))
    return {valid:false,message:'标题与选定比较不一致。请重新生成文案。'};
  const paragraphs=String(body??'').trim().split(/\r?\n[ \t]*\r?\n/).map(normalizeText).filter(Boolean);
  const remaining=new Set(paragraphs);
  if(remaining.size!==paragraphs.length)return {valid:false,message:'正文含有重复段落。'};
  for(const segment of expected.segments){
    if(!remaining.delete(normalizeText(segment.value))&&segment.required)
      return {valid:false,message:'正文的价格、日期或范围无法核对。请重新生成文案。'};
  }
  if(remaining.size)
    return {valid:false,message:'正文含有无法验证的改动。可以调整已验证段落的顺序、删去可选段落，或重新生成。'};
  return {valid:true,message:'已核对价格、调查日期、市场数和范围。'};
}

export function buildMarketPostIdea(quote,period,surveyDate,prices){
  const evidence=evidenceForQuote(quote,period,prices,surveyDate);
  if(!evidence?.publishable||evidence.region||evidence.percent===0)return '';
  const options={language:'bm',format:'casual',channel:'facebook'};
  const draft=composeCreatorDraft(evidence,options);
  return validateCreatorDraft(draft,evidence,options).valid?draft.title+'\n\n'+draft.body:'';
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
    metrics:normalizeMetrics(r.metrics),evidence,settings:draftSettings(r.settings),
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
export function toCSV(workspace,{includeTitle=()=>true}={}){
  const records=readWorkspace(workspace).records;
  const fields=['id','title','status','channel','scheduledDate','postedDate','postUrl',
    'evidenceDate','reach','likes','comments','shares','messages','joins','orders'];
  const escape=value=>'"'+String(value??'').replace(/"/g,'""').replace(/[\r\n]+/g,' ')+'"';
  const rows=records.map(r=>fields.map(key=>
    escape(key==='title'&&!includeTitle(r)?'':key in r.metrics?r.metrics[key]:r[key])).join(','));
  return fields.map(escape).join(',')+'\r\n'+rows.join('\r\n')+(rows.length?'\r\n':'');
}
