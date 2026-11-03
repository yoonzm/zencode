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

test('23 repository task exposes one workspace action and opens it without selecting a repository',{skip:!modulePath||!existsSync(modulePath)},async()=>{
  if(runtime&&!process.env.PLAYWRIGHT_BROWSERS_PATH)process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(runtime,'browsers');
  const {chromium}=createRequire(import.meta.url)(modulePath);
  const bundle=await build({stdin:{contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {TaskDetail} from './src/components/views/task-detail';
    import {TooltipProvider} from './src/components/ui/tooltip';
    import {store} from './src/store/state';
    window.calls=[];window.desktop={call:async(op,args)=>{window.calls.push({op,args});return []}};
    const task={id:'story-7',kind:'story',no:7,title:'资产统计文案调整',product:'P',module:'资产管理',priority:2,assignee:'me',repoId:'team/repo-0',manual:true,labels:[],description:[],attachments:[],history:[],run:{state:'review',worktree:'C:/fixture/task-7',branch:'zencode/story-7',model:'',events:[],files:[],viewed:[],repositories:Array.from({length:23},(_,i)=>({mapping:{repo:'team/repo-'+i,branch:'main'},worktree:'C:/fixture/task-7/repo-'+i,path:'repo-'+i,branch:'zencode/story-7',base:'fixture'}))}};
    store.set({tasks:[task],tab:'run'});
    createRoot(document.getElementById('root')).render(<TooltipProvider><TaskDetail id={task.id}/></TooltipProvider>);
  `,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':path.resolve('src')},define:{'process.env.NODE_ENV':'"production"'}});
  const css=await readFile(path.join('dist/assets',(await readdir('dist/assets')).find(n=>n.endsWith('.css'))));
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8');
    res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/app.css'?css:'<html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1200,height:800}});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    const editor=page.getByRole('menuitem',{name:'在 VS Code 中打开工作区',exact:true});
    await editor.waitFor();
    assert.equal(await page.getByRole('menuitem').filter({hasText:'VS Code'}).count(),1);
    assert.equal(await page.getByRole('menuitem').filter({hasText:'team/repo-'}).count(),0);
    assert.ok((await page.getByRole('menu').boundingBox()).height<400);
    if(process.env.ZENCODE_WORKSPACE_MENU_SCREENSHOT)await page.screenshot({path:process.env.ZENCODE_WORKSPACE_MENU_SCREENSHOT});
    await editor.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.calls.some(c=>c.op==='openWorkdir'));
    assert.deepEqual(await page.evaluate(()=>window.calls.find(c=>c.op==='openWorkdir').args),{id:'story-7',editor:true});
    await page.setViewportSize({width:800,height:600});
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    await page.getByRole('menuitem',{name:'在文件夹中打开工作区',exact:true}).click();
    await page.waitForFunction(()=>window.calls.filter(c=>c.op==='openWorkdir').length===2);
    assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.op==='openWorkdir')[1].args),{id:'story-7',repo:undefined});
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
