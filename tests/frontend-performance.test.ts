import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('dashboard navigation yields before expensive page rendering',async()=>{
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  assert.match(source,/function navigateDashboardPage[\s\S]*?requestAnimationFrame\(\(\)=>\{if\(token!==navigationRenderToken/);
  assert.doesNotMatch(source,/function bindPage\(\)\{enhanceDashboardSemantics\(\);bindLegacy\(\)/);
});

test('AX panel refresh binds only panel controls',async()=>{
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const refresh=source.slice(source.indexOf('function refreshAxPanel'),source.indexOf('function openAxPanel'));
  assert.match(refresh,/bindAxPanelControls\(\)/);
  assert.doesNotMatch(refresh,/bindPage\(\)/);
  assert.match(source,/phaseTimers=\[[\s\S]*?updateAxPhase\('관련 지표와 최신 데이터를 조회하고 있습니다'\)/);
});

test('product thumbnails use optimized lazy decoded images',async()=>{
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  assert.match(source,/assets\/products\/optimized/);
  assert.match(source,/loading="lazy" decoding="async" fetchpriority="low"/);
});
