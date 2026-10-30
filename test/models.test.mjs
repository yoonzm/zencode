import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
test('model switches retain supported efforts and otherwise use the returned default', async () => {
  globalThis.window = {};
  const result = await build({entryPoints:['src/data/models.ts'],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':`${process.cwd()}/src`}});
  const { selection } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const model = {model:'actual-id',defaultReasoningEffort:'ultra',supportedReasoningEfforts:[{reasoningEffort:'ultra'},{reasoningEffort:'max'}]};
  assert.deepEqual(selection(model,'max'),{model:'actual-id',effort:'max'});
  assert.deepEqual(selection(model,'medium'),{model:'actual-id',effort:'ultra'});
});
