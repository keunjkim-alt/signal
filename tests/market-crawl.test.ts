import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsvLine} from '../scripts/prepare-market-crawl-sample.mjs';

test('crawler CSV parser preserves quoted commas and escaped quotes',()=>{
  const row=parseCsvLine('29cm,123,"브랜드, 에디션","셔츠 ""블루""",10000');
  assert.deepEqual(row,['29cm','123','브랜드, 에디션','셔츠 "블루"','10000']);
});
