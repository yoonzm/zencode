import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';

const runtime=process.env.APPDATA&&path.join(process.env.APPDATA,'io.github.yoonzm.zencode/verification-runtime/playwright-1.58.2');
const modulePath=process.env.ZENCODE_PLAYWRIGHT_MODULE||(runtime&&path.join(runtime,'node_modules/playwright'));

test('task list restores filters and independent group expansion after reload and remount',{skip:!modulePath||!existsSync(modulePath)},async()=>{
  if(runtime&&!process.env.PLAYWRIGHT_BROWSERS_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(runtime,'browsers');
  const {chromium}=createRequire(import.meta.url)(modulePath);
  const app=process.cwd();
  const bundled=await build({stdin:{contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {TaskListPane} from './src/components/views/task-list';
    import {TooltipProvider} from './src/components/ui/tooltip';
    import {store,hydrate,flushPrefs} from './src/store/state';
    const tasks=['idle','completed','running'].map((state,i)=>({id:'task-'+state,no:i+1,kind:'story',title:'Alpha '+state,product:'P',module:'Module',priority:2,assignee:'me',labels:[],createdAt:1,updatedAt:1,run:{state,events:[],files:[]}}));
    tasks.push({...tasks[0],id:'other',no:4,title:'Beta',product:'Q',priority:1});
    window.desktop={call:async(op,args)=>{
      if(op==='load')return {prefs:{config:{...store.get().config,mappings:[{id:'p',product:'P',repos:[]},{id:'q',product:'Q',repos:[]}]},...JSON.parse(localStorage.getItem('fixture-prefs')||'{}')},tasks,platform:'win'};
      if(op==='save')localStorage.setItem('fixture-prefs',JSON.stringify(args));
    }};
    window.store=store;window.flush=flushPrefs;
    function App(){const [mounted,setMounted]=useState(true);window.setMounted=setMounted;
      return <TooltipProvider>{mounted&&<TaskListPane className="h-screen"/>}</TooltipProvider>;
    }
    hydrate().then(()=>createRoot(document.getElementById('root')).render(<App/>));
  `,loader:'tsx',resolveDir:app},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':path.join(app,'src')},define:{'process.env.NODE_ENV':'"production"'}});
  const cssFile=(await readdir('dist/assets')).find(name=>name.endsWith('.css'));
  const css=await readFile(path.join('dist/assets',cssFile));
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8');
    res.end(req.url==='/app.js'?bundled.outputFiles[0].text:req.url==='/app.css'?css:'<html data-theme="dark" lang="zh-CN"><head><meta charset="UTF-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:800,height:800}});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const completed=page.locator('section[aria-label="已完成"] > button[aria-expanded]');
    const idle=page.locator('section[aria-label="待处理"] > button[aria-expanded]');
    await completed.waitFor();
    assert.equal(await completed.getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('[data-task-id="task-completed"]').count(),0);
    await completed.click();await idle.click();
    await page.locator('[data-slot="toggle-group-item"]').filter({hasText:'需求'}).click();
    await page.getByRole('textbox',{name:'搜索任务'}).fill('Alpha');
    for(const [filter,choices] of [['状态',['待处理','已完成']],['优先级',['P2 高']],['负责人',['只看我的']],['产品',['P']]]){
      await page.getByRole('button',{name:new RegExp('^'+filter)}).click();
      for(const choice of choices)await page.getByRole('checkbox',{name:new RegExp(choice)}).check();
      await page.keyboard.press('Escape');
    }
    await page.evaluate(()=>window.flush());
    await page.reload();await completed.waitFor();
    const expected={kind:'story',states:['idle','completed'],priorities:[2],assignee:'me',products:['P'],query:'Alpha'};
    assert.deepEqual(await page.evaluate(()=>window.store.get().filters),expected);
    assert.equal(await completed.getAttribute('aria-expanded'),'true');
    assert.equal(await idle.getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('[data-task-id="task-completed"]').count(),1);
    assert.equal(await page.locator('[data-task-id="task-idle"]').count(),0);
    await page.evaluate(()=>window.setMounted(false));
    await completed.waitFor({state:'hidden'});
    await page.evaluate(()=>window.setMounted(true));await completed.waitFor();
    assert.equal(await completed.getAttribute('aria-expanded'),'true');
    assert.equal(await idle.getAttribute('aria-expanded'),'false');
    await page.evaluate(()=>window.store.set({group:'none'}));
    await page.locator('[data-task-id="task-idle"]').waitFor();
    assert.equal(await page.locator('[data-task-id="task-completed"]').count(),1);
    await page.evaluate(()=>window.store.set({group:'state'}));await idle.waitFor();
    assert.equal(await idle.getAttribute('aria-expanded'),'false');
    await page.getByRole('button',{name:'清除',exact:true}).click();
    await page.evaluate(()=>window.flush());await page.reload();await completed.waitFor();
    assert.equal(await page.getByRole('textbox',{name:'搜索任务'}).inputValue(),'');
    assert.equal(await completed.getAttribute('aria-expanded'),'true','Clearing filters must preserve group expansion');
    await completed.click();await page.evaluate(()=>window.flush());
    await page.reload();await completed.waitFor();
    assert.equal(await completed.getAttribute('aria-expanded'),'false');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
