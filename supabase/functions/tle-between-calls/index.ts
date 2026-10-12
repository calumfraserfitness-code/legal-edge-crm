import { analyse, matchLead, callType, nextBooking, suppression, metrics, parseDatabaseJSON } from './domain.mjs';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type,x-tle-crm-token','access-control-allow-methods':'GET,POST,OPTIONS'};
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...cors,'content-type':'application/json','cache-control':'no-store'}});
const url=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function db(path:string,method='GET',body?:unknown,prefer='return=representation') {
 const response=await fetch(`${url}/rest/v1/${path}`,{method,headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json',Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text(); if(!response.ok)throw new Error(`Database operation failed (${response.status})`);
 return text?parseDatabaseJSON(text):null;
}
async function authorized(req:Request) {
 const supplied=req.headers.get('x-tle-crm-token');
 const expected=Deno.env.get('TLE_CRM_INTEGRATION_TOKEN');
 if(expected && supplied===expected)return 'crm-owner';
 if(supplied && await db('rpc/tle_between_scheduler_verify','POST',{p_token:supplied}))return 'scheduler';
 const token=req.headers.get('authorization');
 if(!token)return null;
 const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,authorization:token}});
 if(!r.ok)return null;
 const user=await r.json();
 const members=await db(`tle_team_members?auth_user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=id,role`);
 if(members.some((m:any)=>['owner','admin'].includes(m.role)))return user.id;
 if(!user.email_confirmed_at)return null;
 const registered=await db(`tle_team_members?email=eq.${encodeURIComponent(String(user.email).toLowerCase())}&active=eq.true&select=id,role,auth_user_id`);
 return registered.some((m:any)=>['owner','admin'].includes(m.role)&&(!m.auth_user_id||m.auth_user_id===user.id))?user.id:null;
}
async function fathomKey(){return Deno.env.get('FATHOM_API_KEY')||await db('rpc/tle_between_fathom_config','POST',{});}
async function leads() {
 const rows:any[]=[]; for(let offset=0;;offset+=1000){const batch=await db(`tle_leads?select=id,data&order=id&limit=1000&offset=${offset}`);rows.push(...batch);if(batch.length<1000)break;} return rows;
}
async function enriched(rows:any[],ls:any[]) {
 const ids=[...new Set(rows.map(r=>r.lead_id).filter(Boolean))];
 const bookings=ids.length?await db(`tle_provider_bookings?lead_id=in.(${ids.join(',')})&select=*&order=start_at.desc&limit=1000`):[];
 const attribution=ids.length?await db(`tle_booking_attribution?lead_id=in.(${ids.join(',')})&select=provider_booking_id,attended,metadata&limit=1000`):[];
 for(const b of bookings){const a=attribution.find((x:any)=>x.provider_booking_id===b.event_id);b.booking_kind=a?.metadata?.call_type||a?.metadata?.booking_type||null;if(a?.attended===true)b.status='attended';}
 return rows.map(r=>{const l=ls.find(x=>String(x.id)===String(r.lead_id));const b=nextBooking(r,bookings);const {pending_source,...publicAnalysis}=r.analysis||{};return {...r,analysis:publicAnalysis,...b,prospect_name:l?.data.name||r.meeting_title,converted:Boolean(l?.data.closed===true||l?.data.stage==='Won'),blocked:suppression(r,l,b)};});
}
async function ingest(meeting:any,ls:any[]) {
 const match=matchLead(meeting,ls);const type=callType(meeting.title||meeting.meeting_title||'',match.lead);
 if(type==='client'||type==='other')return 'excluded';
 const a=analyse(meeting,match.lead);
 const row={fathom_recording_id:String(meeting.recording_id),fathom_url:meeting.url,lead_id:match.lead?.id||null,meeting_title:meeting.title||meeting.meeting_title,meeting_at:meeting.recording_start_time||meeting.scheduled_start_time||meeting.created_at,call_type:type,match_status:match.status,...a,analysis:{...a.analysis,candidates:match.candidates,...(match.status==='matched'?{}:{pending_source:meeting})},processed_at:new Date().toISOString()};
 // Insert only: a duplicate must never overwrite an edited/approved draft or its audit.
 const saved=await db('tle_between_call_preps?on_conflict=fathom_recording_id','POST',row,'resolution=ignore-duplicates,return=representation');return saved.length?'imported':'duplicate';
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method==='GET')return json({service:'tle-between-calls',version:1,fathom_configured:Boolean(await fathomKey()),owner_token_configured:Boolean(Deno.env.get('TLE_CRM_INTEGRATION_TOKEN'))});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const actor=await authorized(req);if(!actor)return json({error:'Owner/admin authentication required'},401);
  const input=await req.json();
  if(actor==='scheduler' && input.action!=='sync')return json({error:'Scheduler is restricted to sync'},403);
  if(input.action==='configure_fathom'){
   const candidate=String(input.key||'').trim();if(candidate.length<20||candidate.length>512)return json({error:'Invalid credential'},400);
   const test=await fetch('https://api.fathom.ai/external/v1/meetings?include_transcript=false',{headers:{'X-Api-Key':candidate}});
   if(!test.ok)return json({error:'Fathom did not accept the credential; nothing saved'},400);
   await db('rpc/tle_between_fathom_config','POST',{p_secret:candidate});return json({saved:true});
  }
  if(input.action==='status')return json({fathom_configured:Boolean(await fathomKey()),owner_token_configured:Boolean(Deno.env.get('TLE_CRM_INTEGRATION_TOKEN')),automatic_schedule:true,email_sending:false});
  if(input.action==='list'){
   const days=Math.max(1,Math.min(Number(input.days)||30,120));const since=new Date(Date.now()-days*86400000).toISOString();
   const rows=await db(`tle_between_call_preps?or=(meeting_at.gte.${since},meeting_at.is.null)&order=meeting_at.desc&limit=200`);
   const dated=rows.filter((r:any)=>Date.parse(r.meeting_at||r.analysis?.meeting_date||r.created_at)>=Date.parse(since));
   const items=await enriched(dated,await leads());return json({items,metrics:metrics(items),window_days:days,limit:200,fathom_configured:Boolean(await fathomKey()),automatic_schedule:true});
  }
  if(input.action==='sync'){
   const apiKey=await fathomKey();if(!apiKey)return json({error:'FATHOM_API_KEY is not configured in this CRM project'},409);
   const ls=await leads();let cursor=input.cursor||null;const counts={imported:0,excluded:0,duplicate:0};
   const days=Math.max(1,Math.min(Number(input.days)||30,120));
   // One bounded page per request. Client or scheduler must follow next_cursor.
   const q=new URLSearchParams({created_after:new Date(Date.now()-days*86400000).toISOString(),include_transcript:'true'});if(cursor)q.set('cursor',String(cursor));
   const r=await fetch(`https://api.fathom.ai/external/v1/meetings?${q}`,{headers:{'X-Api-Key':apiKey}});
   if(!r.ok)return json({error:`Fathom request failed (${r.status}); nothing marked synced`},502);
   const page=await r.json();for(const m of page.items||[])counts[await ingest(m,ls) as keyof typeof counts]++;
   if(actor==='scheduler' && page.next_cursor){
    let next=page.next_cursor;let pages=1;
    while(next&&pages<5){q.set('cursor',next);const more=await fetch(`https://api.fathom.ai/external/v1/meetings?${q}`,{headers:{'X-Api-Key':apiKey}});if(!more.ok)return json({error:'Reconciliation incomplete'},502);const batch=await more.json();for(const m of batch.items||[])counts[await ingest(m,ls) as keyof typeof counts]++;next=batch.next_cursor;pages++;}
    if(next)return json({error:'Reconciliation page limit reached; manual continuation needed'},409);page.next_cursor=null;
   }
   return json({...counts,next_cursor:page.next_cursor||null});
  }
  if(input.action==='resolve'){
   if(!/^\d+$/.test(String(input.id)))return json({error:'Invalid record'},400);
   const [prep]=await db(`tle_between_call_preps?id=eq.${input.id}&select=*`);
   if(!prep||prep.updated_at!==input.updated_at)return json({error:'Record changed. Reload first.'},409);
   if(prep.sent_at)return json({error:'Sent records are immutable'},409);
   if(!['triage','strategy','client','other'].includes(input.call_type))return json({error:'Choose a call type'},400);
   const patch:any={call_type:input.call_type,updated_at:new Date().toISOString()};
   let analysis=prep.analysis||{};
   if(input.lead_id){
    const candidate=(analysis.candidates||[]).find((x:any)=>String(x.id)===String(input.lead_id));
    if(!candidate)return json({error:'Choose a suggested candidate; automatic name matching is not allowed'},400);
    const [lead]=await db(`tle_leads?id=eq.${encodeURIComponent(String(input.lead_id))}&select=id,data`);
    if(!lead)return json({error:'Lead no longer exists'},409);
    patch.lead_id=String(lead.id);patch.match_status='matched';
    if(analysis.pending_source){const a=analyse(analysis.pending_source,lead);Object.assign(patch,a);analysis={...analysis,...a.analysis};delete analysis.pending_source;}
   }
   patch.analysis={...analysis,audit:[...(prep.analysis?.audit||[]),{actor,action:'resolve_match_or_classification',at:patch.updated_at,lead_id:patch.lead_id||prep.lead_id,call_type:input.call_type}]};
   const saved=await db(`tle_between_call_preps?id=eq.${input.id}&updated_at=eq.${encodeURIComponent(prep.updated_at)}`,'PATCH',patch);
   return saved.length?json({saved:true}):json({error:'Record changed. Reload first.'},409);
  }
  if(input.action==='review'){
   if(!/^\d+$/.test(String(input.id)))return json({error:'Invalid record'},400);
   const [prep]=await db(`tle_between_call_preps?id=eq.${input.id}&select=*`);if(!prep)return json({error:'Not found'},404);
   if(!['needs_review','approved','rejected','suppressed'].includes(input.approval_status))return json({error:'Invalid decision'},400);
   if(prep.sent_at||prep.approval_status==='sent')return json({error:'Sent records are immutable'},409);
   if(input.updated_at!==prep.updated_at)return json({error:'Record changed. Reload before saving.'},409);
   const [current]=await enriched([prep],await leads());
   if(input.approval_status==='approved'&&current.blocked)return json({error:current.blocked},409);
   if(input.approval_status==='approved'&&(!String(input.draft_subject||'').trim()||!String(input.draft_body||'').trim()))return json({error:'Subject and message required'},400);
   const stamp=new Date().toISOString();
   const patch={draft_subject:String(input.draft_subject||'').slice(0,200),draft_body:String(input.draft_body||'').slice(0,6000),approval_status:input.approval_status,updated_at:stamp,analysis:{...prep.analysis,audit:[...(prep.analysis?.audit||[]),{actor,action:input.approval_status,at:stamp,subject:String(input.draft_subject||'').slice(0,200),body:String(input.draft_body||'').slice(0,6000)}]}};
   const saved=await db(`tle_between_call_preps?id=eq.${input.id}&updated_at=eq.${encodeURIComponent(prep.updated_at)}`,'PATCH',patch);
   if(!saved.length)return json({error:'Record changed. Reload before saving.'},409);
   return json({saved:true});
  }
  return json({error:'Unknown action'},400);
 }catch(_e){return json({error:'Request failed; no success has been recorded'},500);}
});
