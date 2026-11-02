const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const root = process.argv[2];
let created = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const control = JSON.parse(fs.readFileSync(path.join(root, 'control.json')));
  const base = `http://127.0.0.1:${server.address().port}`;
  const record = () => ({iid:4, state:control.state, draft:false, source_branch:control.branch,
    sha:execFileSync('git', ['--git-dir', path.join(root,'repo.git'), 'rev-parse', 'refs/heads/zencode/bug-7'], {windowsHide:true}).toString().trim(),
    web_url:`${base}/team/app/-/merge_requests/4`});
  if (url.pathname.startsWith('/api/v4/')) {
    req.resume();
    fs.appendFileSync(path.join(root,'api.jsonl'),JSON.stringify({method:req.method,path:url.pathname})+'\n');
    res.setHeader('Content-Type','application/json');
    if (url.pathname.endsWith('/merge_requests/4')) { res.end(JSON.stringify(record())); return; }
    if (url.pathname.endsWith('/merge_requests')) {
      if (req.method === 'POST') { created++; res.end(JSON.stringify(record())); }
      else res.end(JSON.stringify(created ? [record()] : []));
      return;
    }
    res.end(JSON.stringify({id:9,http_url_to_repo:`${base}/repo.git`})); return;
  }
  if (control.rejectPush && (url.pathname.endsWith('/git-receive-pack') || url.searchParams.get('service') === 'git-receive-pack')) {
    res.writeHead(403); res.end('Fixture push rejected'); return;
  }
  const chunks=[];
  req.on('data',chunk=>chunks.push(chunk));
  req.on('end',()=>{
    const body=Buffer.concat(chunks);
    const child=spawn('git',['http-backend'],{windowsHide:true,env:{...process.env,GIT_PROJECT_ROOT:root,GIT_HTTP_EXPORT_ALL:'1',REQUEST_METHOD:req.method,PATH_INFO:url.pathname,QUERY_STRING:url.search.slice(1),CONTENT_TYPE:req.headers['content-type']||'',CONTENT_LENGTH:String(body.length)}});
    const output=[];child.stdout.on('data',chunk=>output.push(chunk));
    child.stderr.on('data',chunk=>process.stderr.write(chunk));
    child.on('close',()=>{
      const data=Buffer.concat(output),end=data.indexOf('\r\n\r\n');
      if(end<0){res.writeHead(500);res.end();return;}
      for(const line of data.subarray(0,end).toString().split('\r\n')){
        const i=line.indexOf(':');if(i<0)continue;
        if(line.slice(0,i).toLowerCase()==='status')res.statusCode=Number(line.slice(i+1).trim().split(' ')[0]);
        else res.setHeader(line.slice(0,i),line.slice(i+1).trim());
      }
      res.end(data.subarray(end+4));
    });
    child.stdin.end(body);
  });
});
server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
