import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import { validateColorPalette } from './validate-color-palette.mjs';

const appSource=await readFile('app.js','utf8');
const styleFiles=['styles.css','connections.css','product-images.css','insights.css','daily-trends.css','sales-views.css','phase-one.css','phase-two.css','customer-data.css','review-voc.css','customer-insights-v2.css','phase-three.css','workflow-updates.css','workflow-actions.css','semantic-charts.css','ax-command.css','ax-panel.css','auth.css','data-runtime.css','todays-action.css','discount-optimizer.css','china-tone.css','brand-refresh.css','operational-data.css','closed-beta.css','workspaces.css','data-governance.css','blue-theme.css','color-palette.css','decision-execution.css','performance.css'];
if(/^(<{7}|={7}|>{7})/m.test(appSource))throw new Error('app.js contains unresolved merge-conflict markers');
execFileSync(process.execPath,['--check','app.js'],{stdio:'inherit'});
await validateColorPalette();
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of ['index.html',...styleFiles,'operations.html','operations.css','operations-recovery.css','operations.js','telemetry.js','vercel.json']) await cp(file, `dist/${file}`);
const [{code:minifiedApp},{code:minifiedCss}]=await Promise.all([
  transform(appSource,{loader:'js',minify:true,target:'es2020',charset:'utf8',legalComments:'none'}),
  transform((await Promise.all(styleFiles.map(file=>readFile(file,'utf8')))).join('\n'),{loader:'css',minify:true,target:'es2020',legalComments:'none'})
]);
await Promise.all([writeFile('dist/app.min.js',minifiedApp),writeFile('dist/app.min.css',minifiedCss)]);
const indexPath='dist/index.html',indexHtml=await readFile(indexPath,'utf8'),bundledIndex=indexHtml.replace(/\s*<link rel="stylesheet" href="\.\/[^\"]+" \/>/g,'').replace('</head>','  <link rel="stylesheet" href="./app.min.css?v=20260905c" />\n</head>').replace(/<script defer src="\.\/app\.js[^\"]*"><\/script>/,'<script defer src="./app.min.js?v=20260905c"></script>');
await writeFile(indexPath,bundledIndex.replace('</body>','<script src="./telemetry.js?v=20260905c" defer></script></body>'));
await mkdir('dist/assets', { recursive: true });
await cp('assets', 'dist/assets', { recursive: true });
console.log(`Built static app → dist/ (JS ${Math.round(Buffer.byteLength(minifiedApp)/1024)}KB, CSS ${Math.round(Buffer.byteLength(minifiedCss)/1024)}KB)`);
