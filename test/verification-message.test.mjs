import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('verification JSON is recognized without interpreting ordinary messages or invalid reports', async () => {
  const result = await build({entryPoints: ['src/lib/verification-message.ts'], bundle: true, write: false, format: 'esm'});
  const {parseVerificationMessage: parse, isStreamingVerificationMessage: streaming} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const plan = {state: 'unverified', mode: 'ui', summary: 'Plan only', steps: [{title: 'Open page', status: 'pending', expect: 'Visible'}]};
  assert.deepEqual(parse(JSON.stringify(plan)), plan);
  assert.deepEqual(parse('```json\n' + JSON.stringify(plan) + '\n```'), plan);
  assert.equal(parse('ordinary response'), null);
  assert.equal(parse('{"state":"passed"}'), null);
  assert.equal(parse(JSON.stringify({...plan, steps: [null]})), null);
  assert.equal(parse(JSON.stringify({...plan, steps: [{title: 'Open', status: 'pending', note: {}}]})), null);
  const partial = '{"state":"unverified","mode":"ui","steps":[';
  assert.equal(parse(partial), null);
  assert.equal(streaming(partial), true);
  assert.equal(streaming('Example JSON: ' + partial), false);
});
