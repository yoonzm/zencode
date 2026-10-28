import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('native decorations own window controls while business toolbar keeps drag and commands',()=>{
 const config=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8'));
 assert.equal(config.app.windows[0].decorations,true);
 const titlebar=readFileSync('src/components/shell/titlebar.tsx','utf8');
 assert.doesNotMatch(titlebar,/MacLights|WinControls|windowAction|windowControls/);
 assert.match(titlebar,/drag-region/);assert.match(titlebar,/no-drag/);
 for(const label of ['打开命令面板','切换主题','设置']) assert.ok(titlebar.includes(label));
 const settings=readFileSync('src/components/views/settings.tsx','utf8');
 assert.doesNotMatch(settings,/窗口风格|显示窗口控件|setPlatformPref/);
 assert.doesNotMatch(readFileSync('src-tauri/src/main.rs','utf8'),/"window" =>|\.decorations\(false\)/);
});
