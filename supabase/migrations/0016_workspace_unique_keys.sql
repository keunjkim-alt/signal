begin;

-- Natural identifiers may repeat in separate workspaces. Replace the original
-- organization-wide keys used by file ingestion with workspace-aware keys.
alter table public.products drop constraint if exists products_organization_id_product_code_key;
alter table public.skus drop constraint if exists skus_organization_id_sku_code_key;
alter table public.locations drop constraint if exists locations_organization_id_location_code_key;
alter table public.inventory_snapshots drop constraint if exists inventory_snapshots_organization_id_sku_id_location_id_snapshot_at_key;

alter table public.products add constraint products_org_workspace_product_code_key unique nulls not distinct (organization_id,workspace_id,product_code);
alter table public.skus add constraint skus_org_workspace_sku_code_key unique nulls not distinct (organization_id,workspace_id,sku_code);
alter table public.locations add constraint locations_org_workspace_location_code_key unique nulls not distinct (organization_id,workspace_id,location_code);
alter table public.inventory_snapshots add constraint inventory_snapshots_org_workspace_fact_key unique nulls not distinct (organization_id,workspace_id,sku_id,location_id,snapshot_at);

commit;
