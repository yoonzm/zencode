import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('update controller handles channels, failures, dismissal and shared install guard', async () => {
  globalThis.document = { documentElement: { getAttribute: () => null, setAttribute() {}, removeAttribute() {} } };
  globalThis.window = { matchMedia: () => ({ matches: false }), desktop: { call: async (...args) => globalThis.rpc(...args) } };
  const calls = [];
  let failDownload = true;
  globalThis.rpc = async (op, args) => {
    calls.push([op, args]);
    if (op === 'checkUpdate') return { status: 'available', version: '0.2.0', notes: 'Changes' };
    if (op === 'downloadUpdate') {
      if (failDownload) throw Error('network disconnected');
      globalThis.progress({ payload: { progress: 51 } });
      return { status: 'ready', progress: 100 };
    }
    if (op === 'installUpdate') throw Error('checkpoint failed');
  };
  const bundled = await build({ stdin: { contents: 'export * from "@/store/update"; export {store} from "@/store/state";', resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'browser', alias: { '@': `${process.cwd()}/src` }, plugins: [{ name: 'event-fixture', setup(b) {
    b.onResolve({ filter: /^@tauri-apps\/api\/event$/ }, () => ({ path: 'events', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function listen(name, cb) {globalThis.progress=cb; return () => {globalThis.progress=undefined;};}' }));
  } }] });
  const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  await api.checkUpdate(true);
  assert.equal(api.store.get().update.status, 'available');
  api.dismissUpdate(); await api.checkUpdate(true);
  assert.equal(api.store.get().update.dismissed, true);
  await api.changeChannel('beta');
  assert.equal(calls.at(-1)[1].channel, 'beta');
  await api.downloadUpdate();
  assert.equal(api.store.get().update.status, 'available');
  assert.match(api.store.get().update.error, /network disconnected/);
  failDownload = false;
  await api.downloadUpdate();
  assert.equal(api.store.get().update.status, 'ready');
  assert.equal(globalThis.progress, undefined);
  await api.changeChannel('stable');
  assert.equal(api.store.get().channel, 'beta');
  api.store.set({ tasks: [{ run: { state: 'waiting' } }] });
  api.requestInstall();
  assert.equal(api.store.get().confirm, null);
  api.store.set({ tasks: [{ run: { state: 'running' } }] });
  api.requestInstall();
  assert.ok(api.store.get().confirm);
  await api.installUpdate();
  assert.equal(api.store.get().update.status, 'ready');
  assert.match(api.store.get().update.error, /checkpoint failed/);
  assert.equal(api.updateBusy(), false);
});
