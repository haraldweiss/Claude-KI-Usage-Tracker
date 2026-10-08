import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { parseUsageNumber } from './usage-parsers.js';

for (const name of ['opencode-go', 'zai', 'opencode-api-usage']) {
  test(`${name} serialized callbacks run with tsx name preservation`, () => {
    const input = fs.readFileSync(new URL(`./scrapers/${name}.ts`, import.meta.url), 'utf8');
    const code = transformSync(input, { loader: 'ts', keepNames: true, target: 'es2022' }).code;
    const ast = ts.createSourceFile('fixture.js', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const callbacks: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'evaluate' && node.arguments[0]) {
        const callback = code.slice(node.arguments[0].getStart(ast), node.arguments[0].end);
        if (callback.includes('__name')) callbacks.push(callback);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(callbacks.length > 0);
    const document = { body: { innerText: 'Weekly Quota 3.5%\nCurrent session 96.5% remaining' },
      querySelectorAll: () => [], querySelector: () => null };
    for (const callback of callbacks) {
      assert.throws(() => vm.runInNewContext(`(${callback})()`, { document }), /__name/);
      const realm = vm.createContext({ document });
      vm.runInContext('globalThis.__name = function(value) { return value; };', realm);
      vm.runInContext(`globalThis.__usageNumber = ${parseUsageNumber.toString()};`, realm);
      const result = vm.runInContext(`(${callback})()`, realm);
      assert.ok(result && typeof result === 'object');
      if (name === 'zai') assert.equal(result.weekly_pct, 3.5);
    }
  });
}
