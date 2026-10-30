import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('legacy verification artifacts do not inflate file counts and empty diffs clear cached files', async () => {
  globalThis.window = {matchMedia: () => ({matches: false})};
  globalThis.document = {documentElement: {getAttribute() {}, setAttribute() {}, removeAttribute() {}}};
  globalThis.location = {hash: ''};
  const result = await build({stdin: {contents: 'export {decodeTask} from "./src/store/actions";', resolveDir: process.cwd()}, bundle: true, write: false, format: 'esm', platform: 'browser', alias: {'@': `${process.cwd()}/src`}, define: {'process.env.NODE_ENV': '"production"'}});
  const {decodeTask} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const patch = name => `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1 @@\n+added\n`;
  const task = {manual: true, run: {files: [], rawDiff: patch('.verification/log.json') + patch('app.ts')}};
  assert.deepEqual(decodeTask(task).run.files.map(f => f.path), ['app.ts']);
  task.run.rawDiff = '';
  assert.deepEqual(decodeTask(task).run.files, []);
  delete task.run.rawDiff;
  task.run.files = [{path: '.verification/step.png'}, {path: 'app.ts'}];
  assert.deepEqual(decodeTask(task).run.files.map(f => f.path), ['app.ts']);
});
