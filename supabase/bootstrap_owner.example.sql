-- 1) Supabase Authentication에서 대표 사용자를 먼저 생성합니다.
-- 2) 아래 UUID와 회사 정보를 실제 값으로 바꾼 뒤 한 번 실행합니다.

do $$
declare
  owner_user_id uuid := '00000000-0000-0000-0000-000000000000';
  new_organization_id uuid;
begin
  insert into public.organizations (name,slug)
  values ('YOUR BRAND','your-brand')
  returning id into new_organization_id;

  insert into public.profiles (user_id,display_name)
  values (owner_user_id,'대표 사용자')
  on conflict (user_id) do update set display_name=excluded.display_name,updated_at=now();

  insert into public.organization_memberships (
    organization_id,user_id,role,team_code,status,data_scope
  ) values (
    new_organization_id,owner_user_id,'owner','경영진','active',
    '{"brands":"all","countries":"all","channels":"all","locations":"all"}'::jsonb
  );
end $$;
