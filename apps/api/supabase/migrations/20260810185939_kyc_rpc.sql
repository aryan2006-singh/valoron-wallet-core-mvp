create or replace function public.request_kyc_verification()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  update public.profiles
  set kyc_status = 'pending'
  where id = auth.uid() and kyc_status in ('unverified', 'rejected');

  return jsonb_build_object('kyc_status', (select kyc_status from public.profiles where id = auth.uid()));
end;
$$;

revoke execute on function public.request_kyc_verification() from public;
grant execute on function public.request_kyc_verification() to authenticated;
