const fs = require('node:fs');
const readline = require('node:readline');
const send = v => process.stdout.write(JSON.stringify(v) + '\n');
let seq = 0, pending;
const finish = (id, text) => {
  send({method: 'item/completed', params: {item: {id: `msg-${id}`, type: 'agentMessage', text}}});
  send({method: 'turn/completed', params: {turn: {id, status: 'completed'}}});
};
readline.createInterface({input: process.stdin}).on('line', line => {
  const r = JSON.parse(line), p = r.params, m = r.method;
  if (m === 'initialize') send({id: r.id, result: {}});
  if (m === 'thread/start') {
    if (p.developerInstructions.includes('只在本次独立工作目录中分析或验证仓库') || !p.developerInstructions.includes('访问、登录、部署并验证用户指定的测试环境')) throw Error('Workspace policy blocks remote verification');
    for (const rule of ['Playwright', 'headless: true', 'connectOverCDP', '禁止使用 Computer Use', 'unverified']) {
      if (!p.developerInstructions.includes(rule)) throw Error('Missing isolated headless browser policy: ' + rule);
    }
    fs.writeFileSync('session-policy.json', JSON.stringify(p));
    send({id: r.id, result: {thread: {id: 'fixture'}}});
  }
  if (m === 'turn/start') {
    const id = `turn-${++seq}`, prompt = p.input[0].text;
    if (prompt.includes('private-test-token')) throw Error('Credential leaked');
    send({id: r.id, result: {turn: {id}}});
    const readme = fs.readFileSync('repo-1/README.md', 'utf8');
    if (prompt.includes('最终只输出说明正文')) {
      const policy = JSON.parse(fs.readFileSync('session-policy.json'));
      if (policy.sandbox !== 'read-only') throw Error('Draft not read-only');
      finish(id, `Run ${readme.trim()} (repo-1/README.md)`);
      return;
    }
    const plan = prompt.includes('不执行验证');
    if (!plan && prompt.includes('wait-forever')) return;
    const status = prompt.includes('force-fail') ? 'failed' : 'passed';
    const result = prompt.includes('invalid-report') ? 'not JSON' : JSON.stringify({state: status, summary: 'fixture execution', steps: [{id: '1', title: 'Test README command', expect: readme.trim(), status: plan ? 'pending' : status, note: plan ? '' : 'Actual fixture output'}]});
    if (!plan) {
      pending = {id, result};
      send({id: 100, method: 'item/commandExecution/requestApproval', params: {command: 'fixture-check', reason: 'test approval'}});
    } else finish(id, result);
  }
  if (r.id === 100 && r.result && pending) {
    send({method: 'item/completed', params: {item: {type: 'commandExecution', command: 'fixture-check', exitCode: 0, aggregatedOutput: 'Actual fixture output'}}});
    finish(pending.id, pending.result);
    pending = undefined;
  }
});
