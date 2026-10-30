import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const runner = path.resolve('src-tauri/src/playwright-runtime.cjs');
const {ensure, VERSION} = require(runner);

test('independent task processes install once and reuse the shared runtime', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zencode-playwright-'));
  try {
    const code = `const fs=require('node:fs/promises');const {ensure}=require(${JSON.stringify(runner)});const root=${JSON.stringify(root)};ensure(root,{pollMs:10,probe:()=>fs.access(root+'/ready').then(()=>true,()=>false),install:async()=>{await fs.appendFile(root+'/installs','install\\n');await new Promise(r=>setTimeout(r,100));await fs.writeFile(root+'/ready','ok')}}).catch(e=>{console.error(e);process.exitCode=1})`;
    const task = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', code], {stdio: 'pipe'});
      let errors = '';
      child.stderr.on('data', data => errors += data);
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(errors)));
    });
    await Promise.all([task(), task(), task(), task()]);
    await task();
    assert.equal(await readFile(path.join(root, 'installs'), 'utf8'), 'install\n');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('failed install releases the lock and a later task can repair it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zencode-playwright-'));
  try {
    await assert.rejects(ensure(root, {probe: async () => false, install: async () => {throw new Error('offline');}}), /offline/);
    let ready = false;
    const result = await ensure(root, {probe: async () => ready, install: async () => {ready = true;}});
    assert.equal(result.env.PLAYWRIGHT_BROWSERS_PATH, path.join(root, `playwright-${VERSION}`, 'browsers'));
    assert.equal(result.env.ZENCODE_PLAYWRIGHT_MODULE, result.modulePath);
    await assert.rejects(access(path.join(result.directory, 'install.lock')));
    await writeFile(path.join(result.directory, 'install.lock'), 'existing installer');
    await assert.rejects(ensure(root, {timeoutMs: 0, probe: async () => true}), /locked/);
  } finally { await rm(root, {recursive: true, force: true}); }
});
