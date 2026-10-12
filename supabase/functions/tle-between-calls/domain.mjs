export const norm = x => String(x || '').trim().toLowerCase();
export function parseDatabaseJSON(text) {
  // CRM bigint identifiers exceed Number.MAX_SAFE_INTEGER. Preserve identity end to end.
  return JSON.parse(text.replace(/"(id|lead_id|member_id)"\s*:\s*(\d+)/g, '"$1":"$2"'));
}
export function matchLead(meeting, leads) {
  const emails = new Set((meeting.calendar_invitees || []).filter(x => norm(x.email) !== norm(meeting.recorded_by?.email)).map(x => norm(x.email)).filter(Boolean));
  const candidates = leads.filter(l => emails.has(norm(l.data.email)));
  if (candidates.length === 1) return {status:'matched',lead:candidates[0],candidates:[]};
  if (candidates.length > 1) return {status:'ambiguous',lead:null,candidates:candidates.map(l=>({id:String(l.id),name:l.data.name}))};
  const names = new Set((meeting.calendar_invitees || []).map(x=>norm(x.name)).filter(Boolean));
  const named = leads.filter(l=>names.has(norm(l.data.name)));
  return {status:named.length ? 'review':'unmatched',lead:null,candidates:named.map(l=>({id:String(l.id),name:l.data.name}))};
}
export function callType(title, lead) {
  if (/check.?in|biweekly|monthly call|weekly (call|review)|progress review/i.test(title)) return 'client';
  if (/game.?plan|second call|call 2/i.test(title)) return 'strategy';
  if (/triage|discovery|initial|strategy session/i.test(title)) return 'triage';
  if (isClient(lead)) return 'client';
  return 'unclassified';
}
export function isClient(lead) { return Boolean(lead && (lead.data.closed === true || /^(won|client|active client)$/i.test(lead.data.stage || ''))); }
export function analyse(meeting, lead) {
  const email=norm(lead?.data.email);
  const invitee=(meeting.calendar_invitees||[]).find(i=>norm(i.email)===email);
  const alias=norm(invitee?.matched_speaker_display_name);
  const segments=(meeting.transcript||[]).filter(s=> email && (norm(s.speaker?.matched_calendar_invitee_email)===email || (alias && norm(s.speaker?.display_name)===alias)));
  const rules=[['value',/value depends on price|not worth|same thing over|already know|paying.*same|no.*insights/i],['time',/don.t have (the )?time|no time|hours.*work|work.*(too busy|can.t)|caregiv/i],['past_attempts',/start.*stop|stop.*start|tried.*(before|again)|can.t.*stick|snowballs/i]];
  const evidence=[];
  for (const s of segments) for(const [concern,re] of rules) if(re.test(s.text)) evidence.push({concern,quote:s.text,timestamp:s.timestamp,speaker:s.speaker.display_name});
  const self=segments.find(s=>/on my own|you sought me out|haven.t had that feeling|not interested|don.t want.*coach|rather.*myself/i.test(s.text));
  const curiosity=segments.find(s=>/interested.*(model|business)|curious.*(business|model)/i.test(s.text));
  const primary=evidence[0]?.concern || 'none';
  const demand=self?'self_management_preference':curiosity?'curiosity':'unknown';
  if(self)evidence.push({concern:'self_management',quote:self.text,timestamp:self.timestamp,speaker:self.speaker.display_name});
  if(curiosity)evidence.push({concern:'call_motivation',quote:curiosity.text,timestamp:curiosity.timestamp,speaker:curiosity.speaker.display_name});
  const name=String(lead?.data.name||'').split(' ')[0];
  return {primary_concern:primary,recommended_video: self || !evidence.length ? null : primary==='none'?null:primary,
    evidence:evidence.slice(0,12),analysis:{method:'transcript_rules_v1',demand,reason_for_call:curiosity?'Curiosity about the model':'Not established',next_action:self?'Respect self-management; retain relationship':evidence.length?'Clarify support needs before proposing Call 2':'Review transcript and establish need',unanswered_questions:['What would make paid support worthwhile?','Does the prospect want support now?'],match_email:email,audit:[]},
    draft_subject:evidence.length && !self ? 'Following our conversation':'',
    draft_body:evidence.length && !self ? `Hi ${name},\n\nGood speaking with you. You mentioned: “${evidence[0].quote.slice(0,260)}”\n\nWhat would you most want support to change about that?\n\nCalum`:'',
    suppression_reason:self?'Expressed preference for self-management; coach review required':null};
}
export function nextBooking(prep, bookings) {
  const after=bookings.filter(b=>String(b.lead_id)===String(prep.lead_id)&&Date.parse(b.start_at)>Date.parse(prep.meeting_at||prep.analysis?.meeting_date||prep.created_at)&&(/^(strategy|call2|call_2|second_call|gameplan)$/i.test(b.booking_kind||'')||(prep.next_call_at&&Date.parse(b.start_at)===Date.parse(prep.next_call_at))));
  const future=after.filter(b=>!['cancelled','canceled'].includes(norm(b.status))&&Date.parse(b.start_at)>Date.now()).sort((a,b)=>Date.parse(a.start_at)-Date.parse(b.start_at));
  const last=after.sort((a,b)=>Date.parse(b.start_at)-Date.parse(a.start_at))[0];
  const b=future[0]||last;
  if(!b)return {next_call_status:prep.next_call_status||'unknown',next_call_at:prep.next_call_at||null,meeting_url:null};
  const status=norm(b.status);
  return {next_call_at:b.start_at,next_call_status:['cancelled','canceled'].includes(status)?'cancelled':status==='attended'?'attended':status==='no_show'?'no_show':Date.parse(b.start_at)>Date.now()?'booked':'unknown',meeting_url:b.meeting_url||null};
}
export function suppression(prep, lead, booking) {
  if(prep.approval_status==='suppressed'||prep.suppression_reason)return prep.suppression_reason||'Coach suppressed';
  if(!lead||prep.match_status!=='matched')return 'Lead matching requires review';
  if(isClient(lead))return 'Already a client';
  if(lead.data.optOut===true || lead.data.optedOut===true || lead.data.unsubscribed===true || /opt.?out|do not contact|unsubscribed/i.test(lead.data.status||''))return 'Opted out';
  if(/^(declined|lost|not interested)$/i.test(lead.data.stage||''))return 'Coaching declined';
  if(booking.next_call_status==='cancelled')return 'Call cancelled without a replacement';
  if(prep.call_type!=='triage')return 'Call classification requires review';
  if(!prep.evidence?.length)return 'No transcript evidence available';
  return null;
}
export function metrics(rows) {
  const cohort=new Map();
  for(const r of rows.filter(r=>r.call_type==='triage'&&r.match_status==='matched'&&r.lead_id)) if(!cohort.has(String(r.lead_id)))cohort.set(String(r.lead_id),r);
  const eligible=[...cohort.values()];
  const booked=eligible.filter(r=>['booked','attended','no_show'].includes(r.next_call_status)).length;
  const attended=eligible.filter(r=>r.next_call_status==='attended').length;
  const converted=eligible.filter(r=>r.converted).length;
  return {triage:eligible.length,booked,attended,converted,booking_rate:eligible.length?booked/eligible.length:null,attendance_rate:booked?attended/booked:null,conversion_rate:attended?eligible.filter(r=>r.converted&&r.next_call_status==='attended').length/attended:null};
}
