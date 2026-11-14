/* BG Agro V3.5 — FAMA survey coverage monitor.
 * This is a coverage comparison, NOT a guarantee of complete FAMA publication.
 * Uses the same canonical price-ID and price validity rules as the V3 engine.
 */
import {canonicalDailyRows, validPrice, productIdentity, PRICE_LEVELS} from './engine.mjs?rev=price-evidence-1';

export const MALAYSIA_STATES = Object.freeze([
  'JOHOR','KEDAH','KELANTAN','MELAKA','NEGERI SEMBILAN','PAHANG','PERAK',
  'PERLIS','PULAU PINANG','SABAH','SARAWAK','SELANGOR','TERENGGANU',
  'W.P. KUALA LUMPUR','W.P. LABUAN','W.P. PUTRAJAYA'
]);
const AUDIT_URL = 'https://raw.githubusercontent.com/Luke2929/bg-agro-price-tracker/master/data/fama_fetch_audit.json';
const keyOf = values => JSON.stringify(values);
const clean = value => String(value ?? '').trim();
const place = value => clean(value).toLocaleUpperCase('en-MY');
const esc = value => clean(value).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const count = value => Number(value || 0).toLocaleString('en-MY');

export function summarizeSurvey(rows, excludedPriceIds=[]) {
  const canonical = canonicalDailyRows(rows, excludedPriceIds);
  const states = new Set(), districts = new Map(), locations = new Map(), items = new Map();
  const byLevel = {Ladang:0,Borong:0,Runcit:0};
  let validRecords = 0;
  for (const row of canonical) {
    const state = place(row.negeri), district = place(row.daerah), location = place(row.lokasi);
    const level = clean(row.peringkat), variety = clean(row.varieti);
    if (!state || !variety || !PRICE_LEVELS.includes(level) || validPrice(row.harga) === null) continue;
    validRecords++;
    states.add(state);
    byLevel[level]++;
    if (district) districts.set(keyOf([state,district]),{state,district});
    if (district && location) locations.set(keyOf([state,district,location]),{state,district,location});
    // A product has a stable identity across grades and units. Levels never mix.
    if (district) {
      const identity = productIdentity(row), grade = clean(row.gred), unit = clean(row.unit);
      const key = keyOf([state,district,identity,level]);
      items.set(key,{state,district,variety,grade,unit,level});
    }
  }
  return {rawRecords:rows.length, canonicalRecords:canonical.length, validRecords,
    states:[...states].sort(),districts:[...districts.values()],locations:[...locations.values()],
    items:[...items.values()],byLevel};
}

function difference(previous, current, fields) {
  if (!previous) return [];
  const existing = new Set(current.map(item=>keyOf(fields.map(f=>item[f]))));
  return previous.filter(item=>!existing.has(keyOf(fields.map(f=>item[f]))))
    .sort((a,b)=>fields.map(f=>a[f]).join('\u0000').localeCompare(fields.map(f=>b[f]).join('\u0000')));
}

export function compareSurveys(current, previous=null) {
  const states = new Set(current.states);
  return {
    missingStates:MALAYSIA_STATES.filter(state=>!states.has(state)),
    vanishedStates:previous?previous.states.filter(state=>!states.has(state)):[],
    vanishedDistricts:difference(previous?.districts,current.districts,['state','district']),
    vanishedLocations:difference(previous?.locations,current.locations,['state','district','location']),
    vanishedItems:difference(previous?.items,current.items,['state','district','variety','grade','unit','level']),
    comparable:Boolean(previous)
  };
}

// "Verified" is only an upstream row-count snapshot, not proof FAMA surveyed every market.
export function sourceAudit(date, audit, archiveVersions) {
  const entry=audit?.dates?.[date];
  if (!entry) return {code:'unknown',text:'无来源计数核验'};
  const expected=entry.expected, fetched=entry.fetched, archive=entry.archive_rows;
  const version=archiveVersions?.[date];
  const hash=entry.csv_sha256;
  if (!(Number.isInteger(expected)&&expected>0&&fetched===expected&&
      Number.isInteger(archive)&&archive>=expected&&typeof hash==='string'&&
      /^[0-9a-f]{64}$/i.test(hash))) {
    return {code:'stale',text:'核验记录存在异常'};
  }
  if (version && !hash.toLowerCase().startsWith(String(version).toLowerCase())) {
    return {code:'stale',text:'CSV 已变化，需重新核验'};
  }
  return {code:'verified',text:'来源计数已核对（当时快照）'};
}

function previousDay(dates, day) {
  const i=dates.indexOf(day);
  return i>0?dates[i-1]:null;
}

function renderItems(items, kind) {
  if (!items.length) return '<p class="completeness-empty">此类别没有发现相对于基准日消失的记录。</p>';
  return '<ol class="completeness-missing-list">'+items.map(item=>{
    const loc=[item.state,item.district,item.location].filter(Boolean).map(esc).join(' / ');
    const product=kind==='items' ? '<strong>'+esc(item.variety)+'</strong> · '+
      esc([item.grade,item.unit].filter(Boolean).join(' · '))+
      ' <span class="completeness-level">'+esc(item.level)+'</span>' : '';
    return '<li><span>'+loc+'</span>'+(product?'<small>'+product+'</small>':'')+'</li>';
  }).join('')+'</ol>';
}

function csvValue(value) {
  const text=String(value??'');
  return '"' + text.replaceAll('"','""') + '"';
}

export function createCompletenessMonitor({loadDaily}) {
  const $ = id=>document.getElementById(id);
  let meta=null, entries=[], selectedDay='', selectedTab='states', selectedState='', audit=null;
  let request=0, loaded=false, shown=80;
  const tabs = {states:'16 州／直辖区无报价',districts:'消失的 Daerah',
    locations:'消失的 Lokasi',items:'消失的 Item / L-B-R'};
  const status = (value, bad=false) => {
    $('completeness-status').textContent=value;
    $('completeness-status').classList.toggle('completeness-error',bad);
  };

  async function fetchAudit() {
    try {
      const res=await fetch(AUDIT_URL+'?v='+encodeURIComponent(meta.generated_at_utc||''),{cache:'no-store'});
      if (!res.ok) throw Error('HTTP '+res.status);
      const doc=await res.json();
      return doc?.schema==='bg-agro/fama-daily-fetch-audit/v1'?doc:null;
    } catch {
      return null; // Missing evidence is unknown, not a failed scrape.
    }
  }

  function renderTimeline() {
    const table=$('completeness-timeline');
    table.innerHTML='<div class="completeness-timeline-title">调查日期记录 · 点击查看缺失明细</div>'+
      '<div class="completeness-table-wrap"><table><thead><tr><th>调查日</th><th>有效报价</th>'+
      '<th>州</th><th>较前次消失的 Daerah</th><th>来源核验</th></tr></thead><tbody>'+
      entries.map(item=>{
        const health=sourceAudit(item.date,audit,meta.archive_versions);
        return '<tr><td><button type="button" class="completeness-day'+
          (item.date===selectedDay?' active':'')+'" data-completeness-day="'+esc(item.date)+'">'+
          esc(item.date)+'</button></td><td>'+count(item.current.validRecords)+'</td>'+
          '<td>'+item.current.states.length+'/16</td><td>'+
          (item.previousDate?count(item.diff.vanishedDistricts.length):'无基准')+'</td>'+
          '<td><span class="completeness-audit '+esc(health.code)+'">'+esc(health.text)+'</span></td></tr>';
      }).join('')+'</tbody></table></div>';
  }

  function renderDetails() {
    const entry=entries.find(item=>item.date===selectedDay);
    if (!entry) return;
    const {current,diff,previousDate}=entry;
    const auditState=sourceAudit(entry.date,audit,meta.archive_versions);
    $('completeness-kpis').innerHTML=[
      [count(current.validRecords),'有效原始报价'],
      [current.states.length+' / 16','有报价的州／直辖区'],
      [count(diff.missingStates.length),'无报价州／直辖区'],
      [previousDate?count(diff.vanishedDistricts.length):'—','较前次消失的 Daerah']
    ].map(([value,label])=>'<div><strong>'+value+'</strong><span>'+label+'</span></div>').join('');
    $('completeness-provenance').textContent=
      entry.date+' · 参考基准：'+(previousDate||'无更早的调查日')+' · '+auditState.text+
      '；无报价不等于抓取失败。'+
      (current.rawRecords!==current.canonicalRecords?' 已排除 '+count(current.rawRecords-current.canonicalRecords)+' 笔被取代/重复的 priceid。':'');
    const buckets={
      states:diff.missingStates.map(state=>({state})),
      districts:diff.vanishedDistricts,locations:diff.vanishedLocations,
      items:diff.vanishedItems
    };
    document.querySelectorAll('[data-completeness-tab]').forEach(button=>{
      const kind=button.dataset.completenessTab;
      button.classList.toggle('active',kind===selectedTab);
      button.textContent=tabs[kind]+' ('+buckets[kind].length+')';
    });
    const stateSelect=$('completeness-state');
    const states=[...new Set([
      ...current.states,...diff.missingStates,...diff.vanishedDistricts.map(x=>x.state),
      ...diff.vanishedLocations.map(x=>x.state),...diff.vanishedItems.map(x=>x.state)
    ])].sort();
    stateSelect.innerHTML='<option value="">全马</option>'+states.map(state=>
      '<option value="'+esc(state)+'">'+esc(state)+'</option>').join('');
    if (!states.includes(selectedState)) selectedState='';
    stateSelect.value=selectedState;
    const filtered=buckets[selectedTab].filter(item=>!selectedState||item.state===selectedState);
    $('completeness-detail-count').textContent=filtered.length+' 项 · '+(
      selectedTab==='states'?'全国行政区覆盖':
      !previousDate?'没有前一调查日作为基准':'相对 '+previousDate+' 的消失记录');
    $('completeness-detail-list').innerHTML=renderItems(filtered.slice(0,shown),selectedTab)+
      (filtered.length>shown?'<button type="button" class="secondary-button small" id="completeness-more">'+
      '再显示 80 项（共 '+count(filtered.length)+' 项）</button>':'');
    $('completeness-more')?.addEventListener('click',()=>{shown+=80;renderDetails();});
  }

  async function runRange() {
    if (!meta) return;
    const start=$('completeness-start').value, end=$('completeness-end').value;
    if (!start||!end||start>end) return status('请选择有效的开始和结束日期。',true);
    const days=meta.archive_dates.filter(day=>day>=start&&day<=end);
    if (!days.length) return status('这个日期范围没有已归档的 FAMA 调查日；不自动补造报价。',true);
    if (days.length>31) return status('一次最多分析 31 个有报价的调查日，请缩小范围。',true);
    const id=++request;
    $('completeness-analyze').disabled=true;
    status('准备分析 '+days.length+' 个调查日及其上一调查日…');
    try {
      const required=[...new Set(days.flatMap(day=>[day,previousDay(meta.archive_dates,day)].filter(Boolean)))];
      const summaries=new Map();
      for (let i=0;i<required.length;i+=4) {
        const batch=required.slice(i,i+4);
        const rows=await Promise.all(batch.map(day=>loadDaily(day)));
        if (id!==request) return;
        batch.forEach((day,j)=>summaries.set(day,summarizeSurvey(rows[j],meta.superseded_priceids?.[day]||[])));
        status('已读取 '+Math.min(i+4,required.length)+' / '+required.length+' 个档案，正在比较覆盖情况…');
      }
      audit=await fetchAudit();
      if (id!==request) return;
      entries=days.map(day=>{
        const before=previousDay(meta.archive_dates,day);
        const current=summaries.get(day);
        return {date:day,previousDate:before,current,
          diff:compareSurveys(current,before?summaries.get(before):null)};
      });
      selectedDay=entries.some(e=>e.date===selectedDay)?selectedDay:entries.at(-1).date;
      selectedTab='states';selectedState='';shown=80;
      renderTimeline();renderDetails();
      $('completeness-results').hidden=false;
      status('已分析 '+entries.length+' 个真实调查日。数据差异仅供核查，不能直接判定 FAMA 漏报。'+
        (!audit?' 来源计数核验记录暂时无法读取。':''));
    } catch (error) {
      if (id!==request) return;
      entries=[];$('completeness-results').hidden=true;
      status('原始 CSV 读取或分析失败：'+error.message+'。请稍后重试。',true);
    } finally {
      if (id===request) $('completeness-analyze').disabled=false;
    }
  }

  function exportMissingCsv() {
    if (!entries.length) return;
    const headers=['survey_date','previous_survey_date','category','negeri','daerah','lokasi','varieti','gred','unit','peringkat','description'];
    const lines=[headers];
    for (const item of entries) {
      const base=[item.date,item.previousDate||''];
      for (const state of item.diff.missingStates) lines.push([...base,'state_no_quote',state,'','','','','','No valid quote on this date; not proof of scrape failure']);
      for (const district of item.diff.vanishedDistricts) lines.push([...base,'district_disappeared',district.state,district.district,'','','','','','Present on preceding archived day only']);
      for (const loc of item.diff.vanishedLocations) lines.push([...base,'location_disappeared',loc.state,loc.district,loc.location,'','','','','Present on preceding archived day only']);
      for (const p of item.diff.vanishedItems) lines.push([...base,'item_level_disappeared',p.state,p.district,'',p.variety,p.grade,p.unit,p.level,'Present in district and level on preceding archived day only']);
    }
    const csv='\uFEFF'+lines.map(line=>line.map(csvValue).join(',')).join('\r\n')+'\r\n';
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='bg-agro-missing-'+entries[0].date+'-to-'+entries.at(-1).date+'.csv';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function bind() {
    if (loaded) return;
    loaded=true;
    $('completeness-analyze').addEventListener('click',runRange);
    $('completeness-export').addEventListener('click',exportMissingCsv);
    $('completeness-timeline').addEventListener('click',event=>{
      const day=event.target.closest('[data-completeness-day]')?.dataset.completenessDay;
      if (!day) return;
      selectedDay=day;shown=80;selectedState='';
      renderTimeline();renderDetails();
    });
    document.querySelectorAll('[data-completeness-tab]').forEach(button=>
      button.addEventListener('click',()=>{selectedTab=button.dataset.completenessTab;shown=80;renderDetails();}));
    $('completeness-state').addEventListener('change',event=>{
      selectedState=event.target.value;shown=80;renderDetails();
    });
  }

  return {
    refresh(nextMeta) {
      meta=nextMeta;
      bind();
      ++request;
      const dates=meta.archive_dates;
      const start=$('completeness-start'),end=$('completeness-end');
      for (const input of [start,end]) { input.min=dates[0];input.max=dates.at(-1); }
      const validRange=start.value&&end.value&&start.value<=end.value&&
        start.value>=dates[0]&&end.value<=dates.at(-1);
      if (!validRange) {
        start.value=dates[Math.max(0,dates.length-7)];
        end.value=dates.at(-1);
      }
      $('completeness-results').hidden=true;
      status('选择日期范围，系统将与每一天的上一有记录调查日逐项比较。');
      runRange();
    }
  };
}
