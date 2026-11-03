import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';

const runtime=process.env.APPDATA && path.join(process.env.APPDATA,'io.github.yoonzm.zencode/verification-runtime/playwright-1.58.2');
const modulePath=process.env.ZENCODE_PLAYWRIGHT_MODULE || (runtime && path.join(runtime,'node_modules/playwright'));
test('verification target opens externally and updates with reports, while non-URLs stay plain text', {skip:!modulePath || !existsSync(modulePath)}, async()=>{
  if(runtime && !process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(runtime,'browsers');
  const {chromium}=createRequire(import.meta.url)(modulePath);
  const bundle=await build({stdin:{contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {VerifyTab} from './src/components/views/verify-tab';
    window.calls=[];window.desktop={call:async(op,args)=>{window.calls.push({op,args});return []}};
    function App(){
      const [verify,setVerify]=useState({state:'running',where:'local',target:'http://127.0.0.1:18765/#/dashboard/asset-statistics',summary:'正在验证',steps:[{id:'1',title:'检查页面',expect:'页面正常',status:'pending'}],checks:[],logs:[]});
      window.setVerify=patch=>setVerify(previous=>({...previous,...patch}));
      return <VerifyTab task={{id:'bug-1',run:{state:'running',verify}}}/>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':path.resolve('src')},define:{'process.env.NODE_ENV':'"production"'}});
  const css=await readFile(path.join('dist/assets',(await readdir('dist/assets')).find(name=>name.endsWith('.css'))));
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8');
    res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/app.css'?css:'<html data-theme="dark" lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:700,height:800}});
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const link=page.getByRole('link');
    assert.equal(await link.getAttribute('href'),'http://127.0.0.1:18765/#/dashboard/asset-statistics');
    await link.click();
    await link.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.calls.filter(call=>call.op==='open').length===2);
    assert.deepEqual(await page.evaluate(()=>window.calls.filter(call=>call.op==='open').map(call=>call.args.url)),Array(2).fill('http://127.0.0.1:18765/#/dashboard/asset-statistics'));
    await page.evaluate(()=>window.setVerify({target:'https://test.example.test/new',steps:[{id:'1',title:'检查页面',expect:'页面正常',status:'passed',note:'实际页面符合预期'}]}));
    await page.getByText('实际页面符合预期',{exact:true}).waitFor();
    assert.equal(await link.getAttribute('href'),'https://test.example.test/new');
    for(const target of ['未提供地址','javascript:alert(1)','file:///C:/secret','https://user:secret@example.test/']){
      await page.evaluate(target=>window.setVerify({target}),target);
      await page.getByText(target,{exact:true}).waitFor();
      assert.equal(await page.getByRole('link').count(),0);
    }
    await page.evaluate(()=>window.setVerify({target:'https://test.example.test/'+ 'long-path/'.repeat(30)}));
    await page.setViewportSize({width:375,height:800});
    await link.waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
