begin;

-- The same marketplace review id can legitimately exist in independent brand
-- workspaces. Include workspace in the natural key so one brand import cannot
-- update another brand's review row.
alter table public.product_reviews
  drop constraint if exists product_reviews_organization_id_platform_source_review_id_key;

create unique index if not exists product_reviews_workspace_source_key
  on public.product_reviews(organization_id,workspace_id,platform,source_review_id);

commit;
