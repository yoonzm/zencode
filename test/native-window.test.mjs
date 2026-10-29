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

test('upstream shell keeps one search entry and anchors settings below the scrollable navigation',()=>{
 const titlebar=readFileSync('src/components/shell/titlebar.tsx','utf8');
 assert.match(titlebar,/flex h-10 shrink-0/);
 assert.match(titlebar,/!sidebarOpen && route.name !== "setup"/);
 assert.equal((titlebar.match(/aria-label="打开命令面板"/g)||[]).length,1);
 assert.doesNotMatch(titlebar,/aria-label="设置"|w-56/);
 const sidebar=readFileSync('src/components/shell/sidebar.tsx','utf8');
 const expandedSidebar=sidebar.slice(sidebar.indexOf('export function Sidebar('));
 assert.ok(expandedSidebar.indexOf('<Settings className=')>expandedSidebar.indexOf('</nav>'));
 const shell=readFileSync('src/components/shell/app-shell.tsx','utf8');
 assert.match(shell,/className="h-full shrink-0 overflow-hidden/);
 assert.match(shell,/compact && <TitleBar/);
 assert.match(shell,/!full && !compact/);
 assert.match(shell,/showInline \? <Sidebar \/> : <SidebarRail \/>/);
 assert.match(shell,/width: showInline \? SIDEBAR_W : RAIL_W/);
 assert.match(shell,/left-0 top-10 z-50/);
});
