import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
test('failed credential persistence does not retry on toast updates and supports explicit retry',async()=>{
 let saves=0;
 const attrs=new Map();
 globalThis.document={documentElement:{getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)}};
 globalThis.localStorage={removeItem:()=>{}};
 globalThis.window={desktop:{call:async op=>{if(op==='load')return {prefs:{platformPref:'mac'},tasks:[]};if(op==='save'){saves++;throw Error('Vault unavailable');}}},dispatchEvent:()=>true,matchMedia:()=>({matches:false})};
 const result=await build({entryPoints:['src/store/state.ts'],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':`${process.cwd()}/src`},define:{'process.env.NODE_ENV':'"production"'}});
 const {store,hydrate,flushPrefs}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
 await hydrate();assert.equal(store.get().platform,'mac');
 store.set({sidebarOpen:false});await assert.rejects(flushPrefs(),/Vault unavailable/);assert.equal(saves,1);
 store.set({toasts:[]});await new Promise(r=>setTimeout(r,10));assert.equal(saves,1);
 await assert.rejects(flushPrefs(),/Vault unavailable/);assert.equal(saves,2);
});
