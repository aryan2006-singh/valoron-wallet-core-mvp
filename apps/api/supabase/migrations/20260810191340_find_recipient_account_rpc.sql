create or replace function public.find_recipient_account(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select a.id into v_account_id
  from auth.users u
  join public.accounts a on a.user_id = u.id
  where lower(u.email) = lower(p_email);

  return v_account_id;
end;
$$;

revoke execute on function public.find_recipient_account(text) from public;
grant execute on function public.find_recipient_account(text) to authenticated;
