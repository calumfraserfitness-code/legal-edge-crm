-- Scoped server-only credential RPCs. No secret is stored in a public table.
create or replace function public.tle_between_fathom_config(p_secret text default null)
returns text language plpgsql security definer set search_path='' as $$
declare sid uuid; value text;
begin
 if coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
 select id,decrypted_secret into sid,value from vault.decrypted_secrets where name='tle_between_fathom_key';
 if p_secret is not null then
  if length(p_secret)<20 or length(p_secret)>512 then raise exception 'Invalid credential'; end if;
  if sid is null then perform vault.create_secret(p_secret,'tle_between_fathom_key','Between Calls Fathom credential'); else perform vault.update_secret(sid,p_secret); end if;
  return 'saved';
 end if;
 return value;
end $$;
revoke all on function public.tle_between_fathom_config(text) from public,anon,authenticated;
grant execute on function public.tle_between_fathom_config(text) to service_role;
create or replace function public.tle_between_scheduler_verify(p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
 return exists(select 1 from vault.decrypted_secrets where name='tle_between_scheduler_token' and decrypted_secret=p_token);
end $$;
revoke all on function public.tle_between_scheduler_verify(text) from public,anon,authenticated;
grant execute on function public.tle_between_scheduler_verify(text) to service_role;
-- Future scheduler setup can safely use this token without emitting it to a client.
do $$begin
 if not exists(select 1 from vault.secrets where name='tle_between_scheduler_token') then perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'tle_between_scheduler_token','Internal Between Calls polling authentication'); end if;
end $$;
-- Bounded automatic reconciliation every 15 minutes. Missing provider credentials
-- return a visible 409; this job never sends prospect messages.
do $$begin
 if not exists(select 1 from cron.job where jobname='tle-between-calls-reconcile') then
 perform cron.schedule('tle-between-calls-reconcile','*/15 * * * *',$job$
  select net.http_post(
   url := 'https://fsnzlphhasagfffxdwtq.supabase.co/functions/v1/tle-between-calls',
   headers := jsonb_build_object('Content-Type','application/json','x-tle-crm-token',(select decrypted_secret from vault.decrypted_secrets where name='tle_between_scheduler_token')),
   body := '{"action":"sync","days":30}'::jsonb,
   timeout_milliseconds := 60000
  );
 $job$);
 end if;
end $$;
