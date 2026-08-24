import {createHash} from 'node:crypto';
import {createReadStream,mkdirSync,statSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {createInterface} from 'node:readline';

const expected=['site','product_id','collected_at','url','brand','product_name','category','list_price','sale_price','discount_rate','price_scope','sale_status','rank','rank_type','rating','rating_scale','review_count'];

export function parseCsvLine(line){
  const values=[];let value='';let quoted=false;
  for(let i=0;i<line.length;i+=1){const char=line[i];if(quoted){if(char==='"'&&line[i+1]==='"'){value+='"';i+=1}else if(char==='"'){quoted=false}else value+=char}else if(char==='"')quoted=true;else if(char===','){values.push(value);value=''}else value+=char}
  values.push(value);return values;
}

const clean=value=>String(value??'').trim();
const nullable=value=>clean(value)||null;
const finite=value=>{const normalized=clean(value).replaceAll(',','');if(!normalized)return null;const number=Number(normalized);return Number.isFinite(number)?number:null};
const sql=value=>value===null||value===undefined?'null':`'${String(value).replaceAll("'","''")}'`;
const json=value=>sql(JSON.stringify(value));

function inc(map,key){map.set(key,(map.get(key)||0)+1)}
function top(map,limit=20){return [...map].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([value,count])=>({value,count}))}

export async function analyzeAndSample(input,{perSite=200,outputSql,outputStats,batchDir,batchSize=100}={}){
  const reader=createInterface({input:createReadStream(input),crlfDelay:Infinity});
  const samples=new Map(),sites=new Map(),categories=new Map(),brands=new Map(),nulls=Object.fromEntries(expected.map(key=>[key,0]));
  const invalidNumeric=Object.fromEntries(['list_price','sale_price','discount_rate','rank','rating','review_count'].map(key=>[key,0]));
  let header=null,rows=0,malformed=0,minCollected=null,maxCollected=null;
  for await(const rawLine of reader){
    if(!header){header=parseCsvLine(rawLine.replace(/^\uFEFF/,''));if(header.join('|')!==expected.join('|'))throw new Error(`Unexpected CSV header: ${header.join(',')}`);continue}
    const values=parseCsvLine(rawLine);if(values.length!==header.length){malformed+=1;continue}
    rows+=1;const row=Object.fromEntries(header.map((key,index)=>[key,clean(values[index])]));
    for(const key of expected)if(!row[key])nulls[key]+=1;
    for(const key of Object.keys(invalidNumeric))if(row[key]&&finite(row[key])===null)invalidNumeric[key]+=1;
    inc(sites,row.site||'(empty)');inc(categories,row.category||'(empty)');inc(brands,row.brand||'(empty)');
    if(row.collected_at){if(!minCollected||row.collected_at<minCollected)minCollected=row.collected_at;if(!maxCollected||row.collected_at>maxCollected)maxCollected=row.collected_at}
    const group=samples.get(row.site)||[];if(group.length<perSite){group.push(row);samples.set(row.site,group)}
  }
  const sampleRows=[...samples.values()].flat();
  const stats={sourceFile:basename(input),byteSize:statSync(input).size,rows,malformed,columns:expected,rowSampleCount:sampleRows.length,perSite,siteCounts:Object.fromEntries(sites),topCategories:top(categories),topBrands:top(brands),nullCounts:nulls,invalidNumericCounts:invalidNumeric,collectedAt:{min:minCollected,max:maxCollected},generatedAt:new Date().toISOString()};
  const valueRows=sampleRows.map(row=>{const collected=row.collected_at;const payload={site:row.site,product_id:row.product_id,collected_at:collected,url:row.url,brand:row.brand,product_name:row.product_name,category:row.category,list_price:nullable(row.list_price),sale_price:nullable(row.sale_price),discount_rate:nullable(row.discount_rate),price_scope:row.price_scope,sale_status:row.sale_status,rank:nullable(row.rank),rank_type:row.rank_type,rating:nullable(row.rating),rating_scale:row.rating_scale,review_count:nullable(row.review_count)};const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');return `(${sql(row.site)},${sql(row.product_id)},${sql(collected)},${sql(row.url)},${sql(row.brand)},${sql(row.product_name)},${sql(row.category)},${finite(row.list_price)??'null'},${finite(row.sale_price)??'null'},${finite(row.discount_rate)??'null'},${sql(row.price_scope)},${sql(row.sale_status)},${finite(row.rank)??'null'},${sql(row.rank_type||'unknown')},${finite(row.rating)??'null'},${sql(row.rating_scale)},${finite(row.review_count)??'null'},${sql(hash)},${json(payload)})`});
  const values=valueRows.join(',\n');
  const dates=[...new Set(sampleRows.map(row=>row.collected_at.slice(0,10)).filter(Boolean))];
  const config=json({schemaVersion:'market-product-v1',sourceFile:basename(input),fullSourceRows:rows,sampleRows:sampleRows.length});
  const seed=[
    `-- Generated from ${basename(input)}. Contains a deterministic platform-stratified sample, not the full source file.`,
    'begin;',
    'insert into public.data_sources(organization_id,source_type,provider,name,status,sync_mode,config,last_synced_at)',
    `select o.id,'api','platform-crawl-sample','외부 플랫폼 크롤링 샘플','active','scheduled',${config}::jsonb,${sql(maxCollected)}::timestamptz`,
    "from public.organizations o where o.slug='viceversa-fashion-ax'",
    "and not exists (select 1 from public.data_sources d where d.organization_id=o.id and d.provider='platform-crawl-sample');",
    `update public.data_sources d set status='active',sync_mode='scheduled',last_synced_at=${sql(maxCollected)}::timestamptz,updated_at=now(),config=${config}::jsonb`,
    "from public.organizations o where d.organization_id=o.id and o.slug='viceversa-fashion-ax' and d.provider='platform-crawl-sample';",
    'with org as (select id from public.organizations where slug=\'viceversa-fashion-ax\' limit 1),',
    "source as (select d.id from public.data_sources d join org o on o.id=d.organization_id where d.provider='platform-crawl-sample' order by d.created_at limit 1)",
    'insert into public.market_product_observations(organization_id,data_source_id,platform,external_product_id,collected_at,observed_date,url,brand_name,product_name,category_path,list_price,sale_price,discount_rate,price_scope,sale_status,rank_value,rank_type,rating,rating_scale,review_count,row_hash,raw_payload)',
    "select o.id,s.id,v.site,v.product_id,v.collected_at::timestamptz,(v.collected_at::timestamptz at time zone 'Asia/Seoul')::date,v.url,v.brand,v.product_name,v.category,v.list_price::numeric,v.sale_price::numeric,v.discount_rate::numeric,v.price_scope,v.sale_status,v.rank_value::integer,v.rank_type,v.rating::numeric,v.rating_scale,v.review_count::integer,v.row_hash,v.raw_payload::jsonb",
    'from (values',
    values,
    '  ) as v(site,product_id,collected_at,url,brand,product_name,category,list_price,sale_price,discount_rate,price_scope,sale_status,rank_value,rank_type,rating,rating_scale,review_count,row_hash,raw_payload)',
    'cross join org o cross join source s',
    'on conflict (organization_id,platform,external_product_id,collected_at,rank_type) do update set',
    '  url=excluded.url,brand_name=excluded.brand_name,product_name=excluded.product_name,category_path=excluded.category_path,list_price=excluded.list_price,sale_price=excluded.sale_price,discount_rate=excluded.discount_rate,price_scope=excluded.price_scope,sale_status=excluded.sale_status,rank_value=excluded.rank_value,rating=excluded.rating,rating_scale=excluded.rating_scale,review_count=excluded.review_count,row_hash=excluded.row_hash,raw_payload=excluded.raw_payload;',
    ...dates.map(date=>`select public.refresh_market_daily_analytics((select id from public.organizations where slug='viceversa-fashion-ax' limit 1),'${date}'::date);`),
    'commit;',
    ''
  ].join('\n');
  writeFileSync(outputSql,seed);writeFileSync(outputStats,`${JSON.stringify(stats,null,2)}\n`);
  if(batchDir){
    mkdirSync(batchDir,{recursive:true});
    const setup=seed.slice(0,seed.indexOf("with org as (select id from public.organizations"))+'commit;\n';
    writeFileSync(join(batchDir,'000_setup.sql'),setup);
    for(let offset=0;offset<valueRows.length;offset+=batchSize){
      const batch=[
        'begin;',
        "with org as (select id from public.organizations where slug='viceversa-fashion-ax' limit 1),",
        "source as (select d.id from public.data_sources d join org o on o.id=d.organization_id where d.provider='platform-crawl-sample' order by d.created_at limit 1)",
        'insert into public.market_product_observations(organization_id,data_source_id,platform,external_product_id,collected_at,observed_date,url,brand_name,product_name,category_path,list_price,sale_price,discount_rate,price_scope,sale_status,rank_value,rank_type,rating,rating_scale,review_count,row_hash,raw_payload)',
        "select o.id,s.id,v.site,v.product_id,v.collected_at::timestamptz,(v.collected_at::timestamptz at time zone 'Asia/Seoul')::date,v.url,v.brand,v.product_name,v.category,v.list_price::numeric,v.sale_price::numeric,v.discount_rate::numeric,v.price_scope,v.sale_status,v.rank_value::integer,v.rank_type,v.rating::numeric,v.rating_scale,v.review_count::integer,v.row_hash,v.raw_payload::jsonb",
        'from (values',
        valueRows.slice(offset,offset+batchSize).join(',\n'),
        ') as v(site,product_id,collected_at,url,brand,product_name,category,list_price,sale_price,discount_rate,price_scope,sale_status,rank_value,rank_type,rating,rating_scale,review_count,row_hash,raw_payload)',
        'cross join org o cross join source s',
        'on conflict (organization_id,platform,external_product_id,collected_at,rank_type) do update set',
        'url=excluded.url,brand_name=excluded.brand_name,product_name=excluded.product_name,category_path=excluded.category_path,list_price=excluded.list_price,sale_price=excluded.sale_price,discount_rate=excluded.discount_rate,price_scope=excluded.price_scope,sale_status=excluded.sale_status,rank_value=excluded.rank_value,rating=excluded.rating,rating_scale=excluded.rating_scale,review_count=excluded.review_count,row_hash=excluded.row_hash,raw_payload=excluded.raw_payload;',
        'commit;',''
      ].join('\n');
      writeFileSync(join(batchDir,`${String(offset/batchSize+1).padStart(3,'0')}_observations.sql`),batch);
    }
    writeFileSync(join(batchDir,'999_refresh.sql'),[...dates.map(date=>`select public.refresh_market_daily_analytics((select id from public.organizations where slug='viceversa-fashion-ax' limit 1),'${date}'::date);`),''].join('\n'));
  }
  return stats;
}

const args=process.argv.slice(2);const input=args.find(arg=>!arg.startsWith('--'));const perSite=Number(args.find(arg=>arg.startsWith('--per-site='))?.split('=')[1]||200);
if(input){const outputSql=resolve(args.find(arg=>arg.startsWith('--sql='))?.slice(6)||'supabase/seed_market_crawl_sample.sql');const outputStats=resolve(args.find(arg=>arg.startsWith('--stats='))?.slice(8)||'supabase/market_crawl_sample_stats.json');const batchDirArg=args.find(arg=>arg.startsWith('--batch-dir='))?.slice(12);const batchSize=Number(args.find(arg=>arg.startsWith('--batch-size='))?.split('=')[1]||100);const stats=await analyzeAndSample(resolve(input),{perSite,outputSql,outputStats,batchDir:batchDirArg?resolve(batchDirArg):undefined,batchSize});process.stdout.write(`${JSON.stringify(stats,null,2)}\n`)}
