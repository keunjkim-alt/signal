import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("AX composer submits follow-up questions with Enter", () => {
  assert.match(source, /function shouldSubmitAxComposer\(event\)\{return event\.key==='Enter'&&!event\.shiftKey&&!event\.isComposing&&event\.keyCode!==229\}/);
  assert.equal((source.match(/if\(shouldSubmitAxComposer\(event\)\)/g) || []).length, 2);
  assert.match(source, /<span>Enter 전송<\/span>/);
  assert.match(source, /backendMode!=='connected'[\s\S]*?refreshAxPanel\(\{scroll:true,preserveDraft:false\}\);return/);
});

test("AX composer preserves Shift Enter for multiline Korean input", () => {
  const submitRule = source.match(/function shouldSubmitAxComposer\(event\)\{([^}]+)\}/)?.[1] || "";
  assert.match(submitRule, /!event\.shiftKey/);
  assert.match(submitRule, /!event\.isComposing/);
  assert.match(submitRule, /event\.keyCode!==229/);
});
