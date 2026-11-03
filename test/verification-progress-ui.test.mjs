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
test('task tabs retain the composer draft and display live verification snapshots', {skip:!modulePath || !existsSync(modulePath)}, async()=>{
  if(runtime && !process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(runtime,'browsers');
  const {chromium}=createRequire(import.meta.url)(modulePath);
  const bundle=await build({stdin:{contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {TaskDetail} from './src/components/views/task-detail';
    import {TooltipProvider} from './src/components/ui/tooltip';
    import {store} from './src/store/state';
    window.calls=[];window.fail=true;
    window.desktop={call:async(op,args)=>{
      window.calls.push({op,args});
      if(op==='codexModels')return [];
      if(op==='start' && window.fail)throw Error('fixture send failure');
      if(op==='refreshDiff')return {files:[],rawDiff:''};
      return [];
    }};
    store.set({tab:'run',tasks:[{id:'bug-1',no:1,kind:'bug',title:'Draft fixture',product:'Product',priority:3,assignee:'me',description:[],history:[],attachments:[],labels:[],run:{state:'running',events:[],files:[],viewed:[],verify:{state:'running',summary:'开始验证',where:'local',steps:[{id:'0',title:'检查页面',expect:'页面正常',status:'pending'},{id:'1',title:'检查筛选',expect:'结果正确',status:'pending'}],checks:[],logs:[]}}}]});
    window.progress=patch=>store.set(s=>({tasks:s.tasks.map(task=>({...task,run:{...task.run,verify:{...task.run.verify,...patch}}}))}));
    createRoot(document.getElementById('root')).render(<TooltipProvider><TaskDetail id="bug-1"/></TooltipProvider>);
  `,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':path.resolve('src')},define:{'process.env.NODE_ENV':'"production"'}});
  const css=await readFile(path.join('dist/assets',(await readdir('dist/assets')).find(name=>name.endsWith('.css'))));
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8');
    res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/app.css'?css:'<html data-theme="dark" lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:850}});
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const area=page.getByRole('textbox',{name:'追加指令'});
    await area.fill('保留未发送草稿');
    await page.getByLabel('选择附加图片').setInputFiles({name:'draft.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64')});
    await page.getByRole('button',{name:'查看图片 1',exact:true}).waitFor();
    await page.getByRole('tab',{name:/验证/}).click();
    assert.equal(await area.isVisible(),false);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>window.calls.some(call=>call.op==='pause')),false);
    await page.evaluate(()=>window.progress({target:'http://127.0.0.1:9000/',steps:[{id:'0',title:'检查页面',expect:'页面正常',status:'running',note:'正在加载页面'},{id:'1',title:'检查筛选',expect:'结果正确',status:'pending'}]}));
    await page.getByText('正在加载页面',{exact:true}).waitFor();
    await page.locator('#panel-verify').getByText('执行中',{exact:true}).waitFor();
    assert.equal(await page.getByRole('link').getAttribute('href'),'http://127.0.0.1:9000/');
    await page.evaluate(()=>window.progress({steps:[{id:'0',title:'检查页面',expect:'页面正常',status:'passed',note:'页面断言通过'},{id:'1',title:'检查筛选',expect:'结果正确',status:'running',note:'选择产品'}]}));
    await page.getByText(/已完成 1\/2 · 通过 1 · 失败 0/).waitFor();
    await page.getByRole('tab',{name:'禅道原文',exact:true}).click();
    await page.getByRole('tab',{name:'执行',exact:true}).click();
    assert.equal(await area.inputValue(),'保留未发送草稿');
    assert.equal(await page.getByRole('button',{name:'查看图片 1',exact:true}).count(),1);
    const send=page.getByRole('button',{name:'发送指令',exact:true});
    await send.click();
    await page.getByText('正在发送…',{exact:true}).waitFor({state:'hidden'});
    await page.getByRole('tab',{name:/验证/}).click();await page.getByRole('tab',{name:'执行',exact:true}).click();
    assert.equal(await area.inputValue(),'保留未发送草稿');
    await page.evaluate(()=>window.fail=false);await send.click();
    await page.waitForFunction(()=>!document.querySelector('#composer').value);
    assert.equal(await page.getByRole('button',{name:'查看图片 1',exact:true}).count(),0);
    await page.getByRole('tab',{name:/验证/}).click();await page.getByRole('tab',{name:'执行',exact:true}).click();
    assert.equal(await area.inputValue(),'');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
