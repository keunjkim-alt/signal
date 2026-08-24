-- Generated from products.csv. Contains a deterministic platform-stratified sample, not the full source file.
begin;
insert into public.data_sources(organization_id,source_type,provider,name,status,sync_mode,config,last_synced_at)
select o.id,'api','platform-crawl-sample','외부 플랫폼 크롤링 샘플','active','scheduled','{"schemaVersion":"market-product-v1","sourceFile":"products.csv","fullSourceRows":2636573,"sampleRows":700}'::jsonb,'2026-08-20T12:01:33+09:00'::timestamptz
from public.organizations o where o.slug='viceversa-fashion-ax'
and not exists (select 1 from public.data_sources d where d.organization_id=o.id and d.provider='platform-crawl-sample');
update public.data_sources d set status='active',sync_mode='scheduled',last_synced_at='2026-08-20T12:01:33+09:00'::timestamptz,updated_at=now(),config='{"schemaVersion":"market-product-v1","sourceFile":"products.csv","fullSourceRows":2636573,"sampleRows":700}'::jsonb
from public.organizations o where d.organization_id=o.id and o.slug='viceversa-fashion-ax' and d.provider='platform-crawl-sample';
commit;
