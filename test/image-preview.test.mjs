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
test('shared image viewer supports zoom, pan, reset, gallery, async retry and focus restoration', {skip:!modulePath || !existsSync(modulePath)}, async()=>{
  if(runtime && !process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(runtime,'browsers');
  const {chromium}=createRequire(import.meta.url)(modulePath);
  const bundle=await build({stdin:{contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ImagePreviews} from './src/components/ui/image-paste';
    import {VerificationShots} from './src/components/views/verification-shots';
    const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=3200;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#edf1f5';ctx.fillRect(0,0,1600,3200);ctx.fillStyle='#204070';ctx.font='100px sans-serif';ctx.fillText('Long screenshot',100,200);
    const image=canvas.toDataURL();window.fail=true;window.escapes=0;
    window.addEventListener('keydown',event=>{if(event.key==='Escape')window.escapes++});
    window.desktop={call:async(op,args)=>{
      if(op==='verificationShots')return [{id:'a',path:'a.png',label:'成功截图',failed:false},{id:'b',path:'b.png',label:'失败截图',failed:true}];
      if(op==='verificationShot'){if(args.path==='b.png' && window.fail)throw Error('fixture missing');return image;}
    }};
    createRoot(document.getElementById('root')).render(<main><ImagePreviews images={[image,image]}/><VerificationShots id="bug-1"/></main>);
  `,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':path.resolve('src')},define:{'process.env.NODE_ENV':'"production"'}});
  const css=await readFile(path.join('dist/assets',(await readdir('dist/assets')).find(name=>name.endsWith('.css'))));
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8');
    res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/app.css'?css:'<html data-theme="dark" lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1000,height:800},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const trigger=page.getByRole('button',{name:'查看图片 1',exact:true});
    await trigger.click();
    const dialog=page.getByRole('dialog',{name:'图片预览',exact:true});await dialog.waitFor();
    const scale=page.getByLabel('缩放比例');
    await page.getByRole('button',{name:'放大',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="缩放比例"]').textContent!=='100%');
    const wrapper=page.locator('.yarl__slide_current .yarl__slide_wrapper');
    const before=await wrapper.getAttribute('style');
    await page.mouse.move(500,400);await page.mouse.down();await page.mouse.move(580,480,{steps:8});await page.mouse.up();
    assert.notEqual(await wrapper.getAttribute('style'),before);
    const dragged=await wrapper.getAttribute('style');
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await wrapper.getAttribute('style'),dragged);
    if(process.env.ZENCODE_IMAGE_PREVIEW_SCREENSHOT) await page.screenshot({path:process.env.ZENCODE_IMAGE_PREVIEW_SCREENSHOT});
    await page.getByRole('button',{name:'适应窗口',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="缩放比例"]').textContent==='100%');
    await page.mouse.dblclick(500,400);
    await page.waitForFunction(()=>document.querySelector('[aria-label="缩放比例"]').textContent!=='100%');
    await page.getByRole('button',{name:'适应窗口',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="缩放比例"]').textContent==='100%');
    await page.mouse.move(500,400);await page.mouse.wheel(0,-400);
    await page.waitForFunction(()=>document.querySelector('[aria-label="缩放比例"]').textContent!=='100%');
    await page.getByRole('button',{name:'下一张',exact:true}).click();
    await page.getByText('第 2 张，共 2 张',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('[aria-label="缩放比例"]').textContent==='100%');
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.evaluate(()=>window.escapes),0);
    await page.getByRole('button',{name:'查看 2 张截图，1 张未达预期',exact:true}).click();
    await page.getByRole('dialog',{name:'验证截图',exact:true}).waitFor();
    await page.getByText('图片加载失败：fixture missing',{exact:true}).waitFor();
    await page.evaluate(()=>window.fail=false);
    await page.getByRole('button',{name:'重试图片',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.yarl__slide_current img')?.naturalWidth===1600);
    await page.locator('.image-preview-caption strong').getByText('未达预期',{exact:true}).waitFor();
    await page.getByRole('button',{name:'上一张',exact:true}).click();
    await page.getByText('第 1 张，共 2 张',{exact:true}).waitFor();
    await page.setViewportSize({width:375,height:650});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
