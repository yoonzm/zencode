import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';

const runtime = process.env.APPDATA && path.join(process.env.APPDATA, 'io.github.yoonzm.zencode/verification-runtime/playwright-1.58.2');
const modulePath = process.env.ZENCODE_PLAYWRIGHT_MODULE || (runtime && path.join(runtime, 'node_modules/playwright'));

test('project prompt dialog preserves edits, removes the switch and fits large and small windows', {skip: !modulePath || !existsSync(modulePath)}, async () => {
  if (runtime && !process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(runtime, 'browsers');
  const {chromium} = createRequire(import.meta.url)(modulePath);
  const app = process.cwd();
  const bundle = await build({stdin:{contents:`
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {RepoMappingEditor} from './src/components/forms/repo-mapping';
    import {TooltipProvider} from './src/components/ui/tooltip';
    window.desktop={call:async(op)=>op==='products'?['P']:op==='gitlabRepos'?[{path:'team/app',defaultBranch:'main'}]:op==='gitlabBranches'?['main']:[]};
    const config={zentao:{},gitlab:{},codex:{}};
    function App(){
      const [mappings,setMappings]=useState([{id:'p',product:'P',repos:[{id:'r',repo:'team/app',branch:'main',role:'',testCmd:''}],verify:{enabled:false,prompt:'Existing project rules'}}]);
      window.mappings=mappings;
      return <TooltipProvider><main style={{padding:24}}><RepoMappingEditor value={mappings} onChange={setMappings} config={config}/></main></TooltipProvider>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `,loader:'tsx',resolveDir:app},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':path.join(app,'src')},define:{'process.env.NODE_ENV':'"production"'}});
  const cssFile = (await readdir('dist/assets')).find(name=>name.endsWith('.css'));
  const css = await readFile(path.join('dist/assets',cssFile));
  const server = createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8');
    res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/app.css'?css:'<html data-theme="dark" lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.getByRole('switch',{name:'启用验证'}).count(),0);
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'项目专有提示词 · P'});
    const area=page.getByRole('textbox',{name:'环境、开发与测试约定'});
    assert.equal(await area.inputValue(),'Existing project rules');
    const bounds=await dialog.boundingBox(), inputBounds=await area.boundingBox();
    assert.ok(bounds.width>=1000,`Dialog width: ${bounds.width}`);
    assert.ok(inputBounds.height>=500,`Input height: ${inputBounds.height}`);
    const rules='## 开发前准备\nUse local environment.\n\n## 如何开发\nFollow conventions.\n\n## 如何验证\nRun relevant tests.';
    await area.fill(rules);
    await dialog.getByRole('button',{name:'保存',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.mappings[0].projectPrompt),rules);
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    assert.equal(await area.inputValue(),rules);
    if(process.env.ZENCODE_PROMPT_SCREENSHOT) await page.screenshot({path:process.env.ZENCODE_PROMPT_SCREENSHOT});
    for(const viewport of [{width:900,height:600},{width:390,height:700}]) {
      await page.setViewportSize(viewport);
      const box=await dialog.boundingBox();
      assert.ok(box.width<=viewport.width && box.height<=viewport.height*0.9+1,JSON.stringify({box,viewport}));
      assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Dialog must not overflow horizontally');
      await dialog.getByRole('button',{name:'取消',exact:true}).click();
      await page.getByRole('button',{name:'编辑',exact:true}).click();
    }
    await page.keyboard.press('Escape');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
});
