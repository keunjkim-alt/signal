import {readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

const limits={javascript:160*1024,css:50*1024,image:80*1024};
const checks=[];
async function measure(label,file,limit,{compressed=false}={}){const size=compressed?gzipSync(await readFile(file)).length:(await stat(file)).size;checks.push({label,file,size,limit,ok:size<=limit,compressed})}

await measure('Main JavaScript (gzip)','dist/app.min.js',limits.javascript,{compressed:true});
await measure('Main CSS (gzip)','dist/app.min.css',limits.css,{compressed:true});
const imageDir='dist/assets/products/optimized',images=(await readdir(imageDir)).filter(file=>/\.(jpe?g|webp|png)$/i.test(file));
for(const image of images)await measure(`Product image ${image}`,path.join(imageDir,image),limits.image);

const failed=checks.filter(check=>!check.ok);
console.table(checks.map(check=>({asset:check.label,sizeKB:Math.round(check.size/1024),limitKB:Math.round(check.limit/1024),status:check.ok?'PASS':'FAIL'})));
if(images.length<16)failed.push({label:'Optimized product image count',size:images.length,limit:16,ok:false});
if(failed.length){console.error(`Performance budget failed: ${failed.map(check=>check.label).join(', ')}`);process.exit(1)}
console.log(`Performance budget passed: ${checks.length} assets checked.`);
