select public.refresh_market_daily_analytics((select id from public.organizations where slug='viceversa-fashion-ax' limit 1),'2026-08-19'::date);
select public.refresh_market_daily_analytics((select id from public.organizations where slug='viceversa-fashion-ax' limit 1),'2026-08-20'::date);
