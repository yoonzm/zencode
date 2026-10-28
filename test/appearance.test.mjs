import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

test('theme previews retain full-width geometry and generated flex rules across WebView button defaults',()=>{
 const source=readFileSync('src/components/views/settings.tsx','utf8');
 const card=source.slice(source.indexOf('function ThemeCard('),source.indexOf('function Preview('));
 assert.ok(card);
 const classes=[...card.matchAll(/className=(?:"([^"]*)"|\{cn\([^\n]*?"([^"]*)"[^\n]*?\)\})/g)].map(m=>m[1]??m[2]);
 const button=classes.find(c=>c.includes('group flex'));
 assert.match(button,/flex-col/);assert.match(button,/items-stretch/);
 const frames=classes.filter(c=>c.includes('h-16'));
 assert.equal(frames.length,2);
 for(const frame of frames){assert.match(frame,/w-full/);assert.match(frame,/overflow-hidden/);}
 const label=classes.find(c=>c.includes('px-0.5'));
 assert.match(label,/flex w-full items-center/);
 assert.ok(classes.some(c=>c.includes('ml-auto')));
 assert.ok(classes.some(c=>c.includes('theme-light')&&c.includes('w-1/2')));
 assert.ok(classes.some(c=>c.includes('theme-dark')&&c.includes('w-1/2')));
 // Check the actual shipped CSS, not just class names in JSX. No browser-policy bypass.
 execFileSync(process.execPath,['build.mjs']);
 const html=readFileSync('dist/index.html','utf8');
 for(const rule of ['.items-stretch{align-items:stretch}', '.w-full{width:100%}', '.flex{display:flex}', '.flex-col{flex-direction:column}', '.ml-auto{margin-left:auto}']) assert.ok(html.includes(rule),rule);
 assert.ok(html.includes('.h-16{height:calc(var(--spacing) * 16)}'));
});
