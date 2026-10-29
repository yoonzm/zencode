const readline = require('node:readline');
const send = v => process.stdout.write(JSON.stringify(v) + '\n');
readline.createInterface({input: process.stdin}).on('line', line => {
  const r = JSON.parse(line), p = r.params;
  if (r.method === 'initialize') send({id:r.id,result:{}});
  if (r.method === 'thread/start') {
    if (p.sandbox !== 'read-only' || p.approvalPolicy !== 'never') throw Error('Unsafe policy');
    send({id:r.id,result:{thread:{id:'manual-fixture'}}});
  }
  if (r.method === 'turn/start') {
    if (p.input[0].text.includes('secret-test-token')) throw Error('Credential leaked');
    const input = JSON.parse(p.input[0].text);
    send({id:r.id,result:{turn:{id:'t'}}});
    if (input.source === 'request-tool') { send({id:900,method:'item/commandExecution/requestApproval',params:{}}); return; }
    const text = input.source === 'invalid' ? 'not JSON' : JSON.stringify([{title:'Export CSV',kind:'story',product:'P',module:'Orders',priority:2,description:input.source,criteria:['Keep filters']}]);
    send({method:'item/completed',params:{item:{type:'agentMessage',text}}});
    send({method:'turn/completed',params:{turn:{id:'t',status:'completed'}}});
  }
});
