/* Independent V3 fallback runner. Committing this file does NOT deploy a Worker.
 * Only an authorized Cloudflare account operator may install its token secret.
 */
const API='https://api.github.com/repos/Luke2929/bg-agro-price-tracker/actions/workflows/scrape.yml';
// GitHub normally polls twice per hour. A 90-minute silence is an
// actionable missed-poll signal, without duplicating healthy executions.
const MAX_SUCCESS_AGE_MS=90*60*1000;
const MAX_PENDING_AGE_MS=180*60*1000;

export function decideRecovery(runs, nowMs=Date.now()){
  if(!Array.isArray(runs))return {dispatch:false,reason:'invalid runs response'};
  const times=runs.map(r=>({...r,time:Date.parse(r.created_at)}))
    .filter(r=>Number.isFinite(r.time)&&r.time<=nowMs).sort((a,b)=>b.time-a.time);
  const lastSuccess=times.find(r=>r.conclusion==='success');
  if(lastSuccess&&nowMs-lastSuccess.time<MAX_SUCCESS_AGE_MS)
    return {dispatch:false,reason:'recent successful GitHub Actions run'};
  if(times.some(r=>['queued','in_progress','waiting','pending'].includes(r.status)&&
    nowMs-r.time<MAX_PENDING_AGE_MS))
    return {dispatch:false,reason:'an existing GitHub Actions run is pending'};
  if(times.some(r=>r.event==='workflow_dispatch'&&nowMs-r.time<MAX_SUCCESS_AGE_MS))
    return {dispatch:false,reason:'fallback recently dispatched; avoid duplicates'};
  return {dispatch:true,reason:lastSuccess?'last successful run is too old':'no successful run in recent history'};
}

async function github(token,path,options={}){
  const response=await fetch(API+path,{
    ...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,
      'X-GitHub-Api-Version':'2022-11-28','User-Agent':'bg-agro-independent-fallback',
      ...(options.headers||{})}
  });
  if(!response.ok)throw Error(`GitHub API ${response.status} for ${path}`);
  return response.status===204?null:response.json();
}

async function alertOperator(env,message){
  if(!env.ALERT_WEBHOOK_URL)return;
  const result=await fetch(env.ALERT_WEBHOOK_URL,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:message})
  });
  if(!result.ok)throw Error(`Alert webhook rejected notification: ${result.status}`);
}

export async function checkAndRecover(env,nowMs=Date.now()){
  if(!env.GITHUB_TOKEN)throw Error('GITHUB_TOKEN secret not configured');
  try{
    const result=await github(env.GITHUB_TOKEN,'/runs?branch=master&per_page=12');
    const decision=decideRecovery(result?.workflow_runs,nowMs);
    if(!decision.dispatch){console.log('BG Agro backup: no action',decision.reason);return decision;}
    await github(env.GITHUB_TOKEN,'/dispatches',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ref:'master',inputs:{scrape_scope:'recent'}})
    });
    const message=`BG Agro backup: dispatched master scrape.yml (${decision.reason})`;
    console.log(message);
    await alertOperator(env,message);
    return {...decision,dispatched:true};
  }catch(error){
    console.error('BG Agro independent fallback failed:',error.message);
    await alertOperator(env,`BG Agro backup monitor error: ${error.message}`);
    throw error;
  }
}

export default {
  async scheduled(_event,env,ctx){ctx.waitUntil(checkAndRecover(env));}
};
