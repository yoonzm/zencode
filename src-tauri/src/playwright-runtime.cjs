// Shared across task worktrees. Never install packages in a business repository.
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const VERSION = '1.58.2';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run(executable, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {stdio: 'inherit', windowsHide: true, ...options});
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Process failed (${code ?? signal})`)));
  });
}

async function ensure(root, operations = {}) {
  const directory = path.join(root, `playwright-${VERSION}`);
  const browsers = path.join(directory, 'browsers');
  const modulePath = path.join(directory, 'node_modules', 'playwright');
  const env = {...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers};
  const probe = operations.probe || (async () => {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(modulePath, 'package.json'), 'utf8'));
      if (manifest.version !== VERSION) return false;
      await run(process.execPath, ['-e', `const {chromium}=require(${JSON.stringify(modulePath)}); (async()=>{const b=await chromium.launch({headless:true});await b.close()})().catch(e=>{console.error(e.message);process.exitCode=1})`], {env, stdio: 'ignore'});
      return true;
    } catch { return false; }
  });
  await fs.mkdir(directory, {recursive: true});
  // All probes run under the lock too, so they never load a partially installed package.
  const lock = path.join(directory, 'install.lock');
  const deadline = Date.now() + (operations.timeoutMs ?? 900000);
  let handle;
  while (!handle) {
    try { handle = await fs.open(lock, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() >= deadline) throw new Error(`Shared Playwright installation is locked: ${lock}. Check the installer process before removing an abandoned lock.`);
      await sleep(operations.pollMs ?? 500);
    }
  }
  try {
    await handle.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
    if (!await probe()) {
      console.error('Preparing shared Playwright runtime (other tasks will reuse it)...');
      if (operations.install) await operations.install();
      else {
        await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({private: true, dependencies: {playwright: VERSION}}));
        // npm.cmd cannot be spawned directly on Windows; resolve npm's JS entry point.
        const npm = process.platform === 'win32'
          ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : null;
        await run(npm ? process.execPath : 'npm', [...(npm ? [npm] : []), 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: directory, env});
        await run(process.execPath, [path.join(modulePath, 'cli.js'), 'install', 'chromium'], {cwd: directory, env});
      }
      if (!await probe()) throw new Error('Shared Playwright browser launch failed after installation. Check OS dependencies and installation logs.');
    }
  } finally {
    await handle.close();
    await fs.unlink(lock);
  }
  return {directory, modulePath, env: {...env, NODE_PATH: path.join(directory, 'node_modules'), ZENCODE_PLAYWRIGHT_MODULE: modulePath}};
}

module.exports = {ensure, VERSION};
if (require.main === module) {
  (async () => {
    const runtime = await ensure(__dirname);
    const [script, ...args] = process.argv.slice(2);
    if (script) await run(process.execPath, [path.resolve(script), ...args], {env: runtime.env});
    else console.log(JSON.stringify({ready: true, modulePath: runtime.modulePath, browsers: runtime.env.PLAYWRIGHT_BROWSERS_PATH}));
  })().catch(error => {console.error(error.message); process.exitCode = 1;});
}
