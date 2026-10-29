create or replace function public.operator_webauthn_store(
  p_action text,
  p_user_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_challenge text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized'; end if;
  if p_user_id is null then raise exception 'Missing operator identity'; end if;
  case p_action
    when 'device' then
      select jsonb_build_object('is_active', d.is_active) into v_result
      from public.operator_devices d where d.auth_user_id = p_user_id;
      return v_result;
    when 'pin-session' then
      select jsonb_build_object('valid', s.unlocked_until > now() and (s.locked_until is null or s.locked_until <= now()))
      into v_result from private.operator_device_secrets s where s.auth_user_id = p_user_id;
      return coalesce(v_result, '{"valid":false}'::jsonb);
    when 'save-challenge' then
      insert into private.operator_webauthn_challenges(auth_user_id,purpose,challenge,expires_at)
      values(p_user_id,p_payload->>'purpose',p_payload->>'challenge',coalesce((p_payload->>'expires_at')::timestamptz,now()+interval '2 minutes'))
      on conflict(auth_user_id) do update set purpose=excluded.purpose,challenge=excluded.challenge,expires_at=excluded.expires_at,created_at=now();
      return '{"ok":true}'::jsonb;
    when 'consume-challenge' then
      delete from private.operator_webauthn_challenges
      where auth_user_id=p_user_id and purpose=p_payload->>'purpose' and expires_at>now()
      returning challenge into v_challenge;
      return jsonb_build_object('challenge',v_challenge);
    when 'get-credential' then
      select jsonb_build_object('credential_id',c.credential_id,'public_key',c.public_key,'sign_count',c.sign_count,'transports',to_jsonb(c.transports))
      into v_result from private.operator_webauthn_credentials c where c.auth_user_id=p_user_id;
      return v_result;
    when 'save-credential' then
      insert into private.operator_webauthn_credentials(auth_user_id,credential_id,public_key,sign_count,transports)
      values(p_user_id,p_payload->>'credential_id',p_payload->>'public_key',coalesce((p_payload->>'sign_count')::bigint,0),
        array(select jsonb_array_elements_text(coalesce(p_payload->'transports','[]'::jsonb))));
      return '{"ok":true}'::jsonb;
    when 'update-counter-unlock' then
      update private.operator_webauthn_credentials set sign_count=greatest(coalesce((p_payload->>'sign_count')::bigint,0),0),updated_at=now()
      where auth_user_id=p_user_id;
      if not found then return '{"ok":false}'::jsonb; end if;
      update private.operator_device_secrets set unlocked_until=now()+interval '5 minutes',updated_at=now()
      where auth_user_id=p_user_id and (locked_until is null or locked_until<=now());
      if not found then return '{"ok":false}'::jsonb; end if;
      update public.operator_devices set last_seen_at=now() where auth_user_id=p_user_id and is_active;
      return '{"ok":true}'::jsonb;
    when 'remove' then
      delete from private.operator_webauthn_credentials where auth_user_id=p_user_id;
      delete from private.operator_webauthn_challenges where auth_user_id=p_user_id;
      return '{"ok":true}'::jsonb;
    else
      raise exception 'Unknown WebAuthn operation';
  end case;
end;
$function$;
revoke all on function public.operator_webauthn_store(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.operator_webauthn_store(text,uuid,jsonb) to service_role;
