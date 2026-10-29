import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('task ordering ignores streaming activity and has stable ties across sync order', async () => {
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.document = { documentElement: { getAttribute: () => null, setAttribute: () => {}, removeAttribute: () => {} } };
  const bundled = await build({ entryPoints: ['src/store/select.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', alias: { '@': `${process.cwd()}/src` } });
  const { sortTasks } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const a = { id: 'bug-1', createdAt: 50, updatedAt: 100, priority: 2, run: { state: 'running', startedAt: 100 } };
  const b = { id: 'bug-2', createdAt: 60, updatedAt: 200, priority: 2, run: { state: 'running', startedAt: 200 } };
  const ids = tasks => tasks.map(t => t.id);
  for (const sort of ['updated', 'priority']) {
    for (const current of [a, b, a, b]) {
      current.lastActivityAt = Date.now();
      current.updatedAt = Date.now();
      current.run.activity = 'new output';
      assert.deepEqual(ids(sortTasks([a, b], sort)), ['bug-2', 'bug-1']);
    }
  }
  a.run.startedAt = b.run.startedAt;
  for (const sort of ['updated', 'priority', 'deadline']) {
    assert.deepEqual(ids(sortTasks([b, a], sort)), ids(sortTasks([a, b], sort)));
  }
  a.run.state = b.run.state = 'review';
  a.updatedAt = 300;
  b.updatedAt = 200;
  assert.deepEqual(ids(sortTasks([b, a], 'updated')), ['bug-1', 'bug-2']);
  for (const state of ['queued', 'running', 'waiting']) {
    a.run = { state };
    b.run = { state };
    assert.deepEqual(ids(sortTasks([a, b], 'updated')), ['bug-2', 'bug-1']);
  }
  a.createdAt = b.createdAt;
  assert.deepEqual(ids(sortTasks([b, a], 'updated')), ['bug-1', 'bug-2']);
});
