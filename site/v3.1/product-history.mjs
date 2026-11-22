/* Product-level FAMA history presentation; consumes official archived history JSON. */
export const HISTORY_LEVELS=['Ladang','Borong','Runcit'];

/** No synthetic dates, no cross-state or cross-level aggregation. */
export function productHistoryRecords(history,{state='',level='',endDate=''}={}){
  if(!Array.isArray(history?.observations)||typeof state!=='string'||
    (level&&!HISTORY_LEVELS.includes(level)))return [];
  return history.observations.filter(row=>
    row&&row.state===state&&(!level||row.level===level)&&
    (!endDate||row.date<=endDate)&&
    /^\d{4}-\d{2}-\d{2}$/.test(row.date)&&
    HISTORY_LEVELS.includes(row.level)&&
    Number.isFinite(row.price)&&row.price>=0&&
    Number.isInteger(row.markets)&&row.markets>0&&
    Number.isInteger(row.observations)&&row.observations>0)
    .sort((a,b)=>b.date.localeCompare(a.date)||
      HISTORY_LEVELS.indexOf(a.level)-HISTORY_LEVELS.indexOf(b.level));
}

function csvCell(value){
  const text=String(value??'');
  const escaped=/^[=+\-@\t\r]/.test(text)?"'"+text:text;
  return '"'+escaped.replace(/"/g,'""')+'"';
}

/** Entire selected state history. CSV rows preserve actual survey dates and units. */
export function productHistoryCSV(history,records){
  const header=['调查日期','州属','品种','品级','价格层级','单位',
    '当日市场等权均价 (RM)','实际调查市场数','来源记录数'];
  return '\uFEFF'+[header,...records.map(r=>[
    r.date,r.state,history.varieti,history.gred||'',r.level,history.unit,
    Number(r.price).toFixed(4),r.markets,r.observations
  ])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
