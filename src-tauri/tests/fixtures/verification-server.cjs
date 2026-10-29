const http = require('node:http');
const {spawn} = require('node:child_process');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/v4/projects/')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({http_url_to_repo: `http://127.0.0.1:${server.address().port}/repo.git`}));
    return;
  }
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const child = spawn('git', ['http-backend'], {windowsHide: true, env: {
      ...process.env, GIT_PROJECT_ROOT: process.argv[2], GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: req.method, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: req.headers['content-type'] || '', CONTENT_LENGTH: String(body.length),
    }});
    const output = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('close', () => {
      const data = Buffer.concat(output), end = data.indexOf('\r\n\r\n');
      if (end < 0) { res.writeHead(500); res.end(data); return; }
      for (const line of data.subarray(0, end).toString().split('\r\n')) {
        const sep = line.indexOf(':');
        if (sep < 0) continue;
        if (line.slice(0, sep).toLowerCase() === 'status') res.statusCode = Number(line.slice(sep + 1).trim().split(' ')[0]);
        else res.setHeader(line.slice(0, sep), line.slice(sep + 1).trim());
      }
      res.end(data.subarray(end + 4));
    });
    child.stdin.end(body);
  });
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
