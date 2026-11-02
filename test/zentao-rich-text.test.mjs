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
test('ZenTao original text renders body and comment images without executing HTML, supports retry and zoom', {skip:!modulePath || !existsSync(modulePath)}, async()=>{
  if(runtime && !process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(runtime,'browsers');
  const {chromium}=createRequire(import.meta.url)(modulePath);
  const bundle=await build({stdin:{contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ZentaoTab} from './src/components/views/zentao-tab';
    import {decodeTask} from './src/store/actions';
    import {store} from './src/store/state';
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=180;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#e9edf1';ctx.fillRect(0,0,640,180);ctx.fillStyle='#202838';ctx.font='24px sans-serif';ctx.fillText('Report screenshot',24,40);ctx.fillStyle='#6a85ac';ctx.fillRect(24,70,590,24);ctx.fillRect(24,112,400,24);
    const image=canvas.toDataURL('image/png');
    window.calls=[];window.failOnce=true;
    window.desktop={call:async(op,args)=>{
      if(op!=='zentaoImage') return null;
      window.calls.push(args);
      if(args.src==='missing.png' && window.failOnce){window.failOnce=false;throw Error('fixture image unavailable');}
      return image;
    }};
    store.set(s=>({config:{...s.config,zentao:{...s.config.zentao,baseUrl:'https://zentao.example.test'}}}));
    const task=decodeTask({id:'bug-7',no:7,kind:'bug',title:'图片需求',ztStatus:'active',priority:4,product:'示例产品',module:'报表管理',sprint:'',assignee:'me',reporter:'alice',createdAt:Date.now(),updatedAt:Date.now(),labels:[],attachments:[],run:{state:'idle'},
      description:[{type:'p',text:'<p><strong>正文详情</strong>：保持筛选条件</p><p><a href="file-read-7.png"><img src="file-read-7.png" alt="正文截图" onload="window.pwned=1"></a></p><table><tr><th>类型</th><td>导出数据</td></tr></table><script>window.pwned=1</script><iframe src="https://untrusted.invalid/"></iframe><a href="javascript:window.pwned=1">不安全链接</a>'}],
      history:[{who:'李聪',at:Date.now(),text:'commented <p><img onload="setImageSize(this,870)" src="https://zentao.example.test/file-read-8.png" alt="备注截图"></p><p><span style="font-size:13px">点击 Word 导出可以下载对应格式的报表。</span></p>'},{who:'alice',at:Date.now(),text:'commented <img src="missing.png" alt="重试截图">'}]});
    window.decoded=task;
    createRoot(document.getElementById('root')).render(<main className="@container mx-auto max-w-4xl"><ZentaoTab task={task}/></main>);
  `,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':path.resolve('src')},define:{'process.env.NODE_ENV':'"production"'}});
  const css=await readFile(path.join('dist/assets',(await readdir('dist/assets')).find(name=>name.endsWith('.css'))));
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8');
    res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/app.css'?css:'<html data-theme="dark" lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1000,height:1100}});
    const errors=[], external=[];page.on('pageerror',error=>errors.push(String(error)));page.on('request',request=>{if(request.url().startsWith('https://')) external.push(request.url());});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('img',{name:'正文截图',exact:true}).waitFor();
    await page.getByRole('img',{name:'备注截图',exact:true}).waitFor();
    await page.getByText('点击 Word 导出可以下载对应格式的报表。',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.decoded.description[0].text.includes('<img')),true);
    assert.equal(await page.locator('#root strong').innerText(),'正文详情');
    assert.equal(await page.locator('#root table').count(),1);
    assert.equal(await page.locator('#root iframe, #root script, #root [onload]').count(),0);
    assert.equal(await page.evaluate(()=>window.pwned),undefined);
    assert.equal(await page.getByRole('button',{name:'不安全链接',exact:true}).count(),0);
    assert.ok(!(await page.locator('#root').innerText()).includes('<p>'));
    await page.getByRole('alert').filter({hasText:'fixture image unavailable'}).waitFor();
    await page.getByRole('button',{name:'重试图片',exact:true}).click();
    await page.getByRole('img',{name:'重试截图',exact:true}).waitFor();
    await page.getByRole('button',{name:'放大图片：备注截图',exact:true}).click();
    await page.getByRole('dialog',{name:'禅道图片',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog',{name:'禅道图片',exact:true}).waitFor({state:'hidden'});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('#root img')).every(image=>image.complete && image.naturalWidth>0));
    assert.equal((await page.evaluate(()=>window.calls)).length,4);
    await page.setViewportSize({width:648,height:1100});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.ZENCODE_RICH_TEXT_SCREENSHOT) await page.screenshot({path:process.env.ZENCODE_RICH_TEXT_SCREENSHOT,fullPage:true});
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
