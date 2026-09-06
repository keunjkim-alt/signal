import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../ax-panel.css", import.meta.url), "utf8");
const readability = css.slice(css.indexOf("/* Readability baseline"));

test("AX conversation typography keeps a readable baseline", () => {
  assert.match(readability, /--ax-panel-width:\s*460px/);
  assert.match(readability, /\.ax-message p\s*\{[^}]*font-size:\s*15px[^}]*line-height:\s*1\.75/s);
  assert.match(readability, /\.ax-message\.user p\s*\{[^}]*font-size:\s*14px[^}]*line-height:\s*1\.65/s);
  assert.match(readability, /\.ax-composer textarea\s*\{[^}]*font-size:\s*14px[^}]*line-height:\s*1\.65/s);
  assert.match(readability, /\.ax-panel-recommendations strong\s*\{[^}]*font-size:\s*12px/s);
  assert.match(readability, /\.ax-panel-mini-viz \.ax-result-bar span,[^}]*font-size:\s*10px/s);
});
