import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

test('a created MR remains accessible while writeback is pending', async () => {
  const result = await build({
    stdin: {contents: `
      import React from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import {TaskDetail} from './src/components/views/task-detail';
      import {store} from '@/store/state';
      export function render(created) {
        store.state = {tab:'run', platform:'win', config:{zentao:{baseUrl:'https://zentao.example'}}, tasks:[{
          id:'bug-1', no:1, kind:'bug', title:'Task', product:'Product', module:'Module', priority:3, assignee:'me',
          run:{state:'review', events:[], files:[], viewed:[], ...(created ? {mr:{iid:260,url:'https://gitlab.example/mr/260'},writebackError:'服务返回空响应'} : {})}
        }]};
        return renderToStaticMarkup(<TaskDetail id="bug-1" />);
      }
    `, resolveDir: process.cwd(), loader: 'tsx'},
    bundle:true, write:false, format:'cjs', platform:'node',
    alias:{'@':`${process.cwd()}/src`}, define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'render-environment', setup(build) {
      build.onLoad({filter:/[\\/]store[\\/]state\.ts$/}, () => ({contents:'export const store={state:null,get(){return this.state}}; export const EMPTY_FILTERS={}; export function useApp(selector){return selector(store.state)} export function applyTheme(){}'}));
      build.onLoad({filter:/[\\/]lib[\\/]desktop\.ts$/}, () => ({contents:'export function desktopCall(){throw Error("Unexpected service call")}' }));
      build.onLoad({filter:/[\\/]views[\\/](timeline|diff-view|zentao-tab|composer)\.tsx$/}, () => ({contents:'export const Timeline=()=>null, DiffView=()=>null, ZentaoTab=()=>null, Composer=()=>null;'}));
    }}],
  });
  const module={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const pending=module.exports.render(true);
  for(const label of ['打开 MR !260','复制 MR 链接','重试禅道回写','MR 已创建，待回写禅道','服务返回空响应']) assert.ok(pending.includes(label),label);
  assert.ok(!pending.includes('创建 Merge Request'));
  const fresh=module.exports.render(false);
  assert.ok(fresh.includes('创建 Merge Request'));
  assert.ok(!fresh.includes('重试禅道回写'));
});
