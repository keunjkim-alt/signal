import {readFile,writeFile} from 'node:fs/promises';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node scripts/enrich-sales-costs.mjs input.csv output.csv');

const text=await readFile(input,'utf8'),lines=text.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/),headers=lines[0].split(','),index=Object.fromEntries(headers.map((name,i)=>[name,i]));
for(const required of ['channel_code','quantity','net_sales','category'])if(index[required]===undefined)throw new Error(`Missing column: ${required}`);
const categoryCost={OUTER:.32,BOTTOM:.30,TOP:.28,DRESS:.34,SHIRT:.29,KNIT:.31};
const channelFee={'자사몰':.03,'무신사':.18,'네이버':.06,'29CM':.16,'W컨셉':.18,'매장 POS':.03};
const rows=lines.slice(1).map(line=>{
  const cells=line.split(','),sales=Number(cells[index.net_sales]||0),qty=Math.max(1,Number(cells[index.quantity]||1)),category=String(cells[index.category]||'').toUpperCase(),channel=cells[index.channel_code],unitRevenue=sales/qty;
  const unitCost=Math.round(unitRevenue*(categoryCost[category]||.31)),fee=Math.round(sales*(channelFee[channel]||.08)),marketing=Math.round(sales*(channel==='매장 POS'?.015:.04)),shipping=channel==='매장 POS'?0:3500*qty,returnCost=Math.round(sales*.006);
  return [...cells.slice(0,index.net_sales+1),unitCost,fee,marketing,shipping,returnCost,...cells.slice(index.net_sales+1)].join(',');
});
const outputHeaders=[...headers.slice(0,index.net_sales+1),'unit_cost','channel_fee','marketing_cost','shipping_cost','return_cost',...headers.slice(index.net_sales+1)];
await writeFile(output,`\uFEFF${outputHeaders.join(',')}\n${rows.join('\n')}\n`,'utf8');
console.log(`Generated ${rows.length} cost-enriched sales rows → ${output}`);
