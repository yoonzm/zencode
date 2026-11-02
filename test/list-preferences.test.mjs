import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

let instance = 0;
async function fixture(initial = {}) {
  let saved = structuredClone(initial);
  const attrs = new Map();
  globalThis.document = {documentElement:{getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)}};
  globalThis.localStorage = {removeItem(){}};
  globalThis.window = {desktop:{call:async(op,args)=>{
    if(op==='load') return {prefs:structuredClone(saved),tasks:[],platform:'win'};
    if(op==='save') saved=structuredClone(args);
  }},dispatchEvent:()=>true,matchMedia:()=>({matches:false})};
  const result = await build({entryPoints:['src/store/state.ts'],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':`${process.cwd()}/src`},define:{'process.env.NODE_ENV':'"production"'}});
  const code=Buffer.from(result.outputFiles[0].text).toString('base64');
  const restart=async()=>{
    const app=await import(`data:text/javascript;base64,${code}#${++instance}`);
    await app.hydrate();return app;
  };
  return {restart,saved:()=>saved};
}

test('filters and group expansion survive a fresh store and preference reload',async()=>{
  const f=await fixture();
  const first=await f.restart();
  assert.deepEqual(first.store.get().collapsedGroups,{completed:true});
  const filters={kind:'story',states:['idle','completed'],priorities:[2,3],assignee:'me',products:['P'],query:'asset'};
  first.store.set({filters,collapsedGroups:{completed:false,idle:true,running:false}});
  await first.flushPrefs();
  assert.deepEqual(f.saved().filters,filters);
  assert.deepEqual(f.saved().collapsedGroups,{completed:false,idle:true,running:false});
  const second=await f.restart();
  assert.deepEqual(second.store.get().filters,filters);
  assert.deepEqual(second.store.get().collapsedGroups,{completed:false,idle:true,running:false});
  second.store.set({filters:second.EMPTY_FILTERS});await second.flushPrefs();
  const third=await f.restart();
  assert.deepEqual(third.store.get().filters,third.EMPTY_FILTERS);
  assert.equal(third.store.get().collapsedGroups.completed,false,'Clearing filters must retain explicit expansion');
});

test('older and partial preferences use defaults without overriding an explicit expansion',async()=>{
  const f=await fixture({filters:{products:['P']},collapsedGroups:{running:true}});
  const app=await f.restart();
  assert.deepEqual(app.store.get().filters,{...app.EMPTY_FILTERS,products:['P']});
  assert.deepEqual(app.store.get().collapsedGroups,{completed:true,running:true});
});

test('invalid persisted filter entries cannot break the list on startup',async()=>{
  const f=await fixture({filters:{kind:'invalid',states:['completed','invalid',null],priorities:[2,0,'1'],assignee:'invalid',products:['P',null],query:null},collapsedGroups:{completed:false,running:true,idle:'yes',unknown:true,all:true}});
  const app=await f.restart();
  assert.deepEqual(app.store.get().filters,{kind:'all',states:['completed'],priorities:[2],assignee:'all',products:['P'],query:''});
  assert.deepEqual(app.store.get().collapsedGroups,{completed:false,running:true});
});
