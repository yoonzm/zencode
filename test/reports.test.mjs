import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('reports skip empty periods, record only successful delivery, and guard concurrent sends', async () => {
  const cfg = {enabled:true,time:'18:00',weekday:5,prompt:'custom prompt'};
  const state = {tasks:[],config:{},feishu:{enabled:true,webhook:'https://open.feishu.cn/open-apis/bot/v2/hook/12345678'},reports:{daily:{...cfg},weekly:{...cfg},log:[]}};
  const calls=[]; let fail=false;
  globalThis.reportFixture={store:{get:()=>state,set:f=>Object.assign(state,f(state))},toast:()=>{},flushPrefs:async()=>{},desktopCall:async(op,args)=>{calls.push([op,args]); if(fail) throw Error('offline'); return ['summary'];}};
  const result=await build({entryPoints:['src/store/report.ts'],bundle:true,write:false,format:'esm',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/state$|toast$|desktop$/},args=>({path:args.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const {store,toast,flushPrefs,desktopCall}=globalThis.reportFixture;',loader:'js'}));}}]});
  const mod=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  await mod.sendReport('daily',{manual:true});
  assert.equal(state.reports.log[0].result,'skipped'); assert.equal(calls.length,0);
  state.tasks=[{id:'x',no:1,kind:'bug',title:'Fix',updatedAt:Date.now(),run:{state:'review',verify:{state:'passed'}}}];
  fail=true; await mod.sendReport('daily',{manual:true});
  assert.equal(state.reports.log.length,1);
  fail=false; await Promise.all([mod.sendReport('daily',{manual:true}),mod.sendReport('daily',{manual:true})]);
  assert.equal(state.reports.log[0].result,'sent');
  assert.equal(calls.filter(([op])=>op==='reportSend').length,1);
  assert.equal(calls.at(-2)[1].prompt,'custom prompt');
  state.reports.log=[];state.tasks=[];
  mod.tickReports(new Date(2026,9,31,18,1).getTime());
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(state.reports.log.length,0);
  delete globalThis.reportFixture;
});
