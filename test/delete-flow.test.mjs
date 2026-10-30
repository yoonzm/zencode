import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('delete confirmation stays busy, reports phases, preserves errors and supports retry', async () => {
  const attrs = new Map();
  globalThis.document = {documentElement: {getAttribute: k => attrs.get(k), setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k)}};
  globalThis.window = {matchMedia: () => ({matches: false})};
  globalThis.location = {hash: '#task-bug-1'};
  let resolveDelete, rejectDelete, progress, calls = 0, unsubscribed = 0;
  window.desktop = {
    call: () => {calls++; return new Promise((resolve,reject) => {resolveDelete = resolve; rejectDelete = reject;});},
    onDeleteProgress: async fn => {progress = fn; return () => {unsubscribed++;};},
  };
  const bundled = await build({stdin: {contents: 'export * from "./src/store/actions"; export {store} from "./src/store/state";', resolveDir: process.cwd()}, bundle: true, write: false, format: 'esm', platform: 'browser', alias: {'@': `${process.cwd()}/src`}, define: {'process.env.NODE_ENV': '"production"'}});
  const a = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  a.store.set({tasks: [{id: 'bug-1', title: 'Task', run: {state: 'review'}}], listStatus: 'ready'});
  a.deleteTask('bug-1');
  const pending = a.runConfirm();
  await Promise.resolve();
  assert.equal(a.store.get().confirm.busy, true);
  a.closeConfirm();
  await a.runConfirm();
  a.deleteTask('bug-1');
  assert.equal(calls, 1);
  progress({id: 'bug-1', message: 'Stopping worker'});
  assert.equal(a.store.get().confirm.progress, 'Stopping worker');
  progress({id: 'other', message: 'Other task'});
  assert.equal(a.store.get().confirm.progress, 'Stopping worker');
  assert.equal(a.store.get().tasks.length, 1);
  rejectDelete(new Error('File in use'));
  await pending;
  assert.equal(a.store.get().confirm.error, 'File in use');
  assert.equal(a.store.get().confirm.busy, undefined);
  assert.equal(a.store.get().tasks.length, 1);
  const retry = a.runConfirm();
  await Promise.resolve();
  resolveDelete({cleanupPending: true});
  await retry;
  assert.equal(a.store.get().confirm, null);
  assert.equal(a.store.get().tasks.length, 0);
  assert.equal(location.hash, '#tasks');
  assert.equal(unsubscribed, 2);
  assert.match(a.store.get().toasts.at(-1).desc, /后台清理/);
});
