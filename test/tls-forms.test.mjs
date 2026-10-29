import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

test('TLS controls default to verification and show service-specific warnings and certificate guidance', async () => {
  const result = await build({
    stdin: {contents: `
      import React from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import {ZentaoForm, GitlabForm} from './src/components/forms/config-forms';
      import {DEFAULT_CONFIG} from './src/data/defaults';
      export function render(kind, insecureTls, message) {
        const Form = kind === 'zentao' ? ZentaoForm : GitlabForm;
        return renderToStaticMarkup(<Form
          value={{...DEFAULT_CONFIG[kind], insecureTls}}
          onChange={() => {}} onTest={() => {}}
          test={{status: message ? 'error' : 'idle', steps: [], message}}
        />);
      }
    `, resolveDir: process.cwd(), loader: 'tsx'},
    bundle: true, write: false, format: 'cjs', platform: 'node',
    alias: {'@': `${process.cwd()}/src`},
    define: {'process.env.NODE_ENV': '"production"'},
    plugins: [{name: 'server-render-environment', setup(build) {
      build.onLoad({filter: /[\\/]store[\\/]state\.ts$/}, () => ({contents: 'export const store = {}; export function useApp() {}'}));
      build.onLoad({filter: /[\\/]lib[\\/]desktop\.ts$/}, () => ({contents: 'export function desktopCall() { throw new Error("Unexpected service call during render"); }'}));
    }}],
  });
  const module = {exports: {}};
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  for (const kind of ['zentao', 'gitlab']) {
    const defaults = module.exports.render(kind);
    assert.match(defaults, /aria-expanded="false"/);
    assert.doesNotMatch(defaults, /已跳过证书验证/);
    const enabled = module.exports.render(kind, true);
    assert.match(enabled, /aria-expanded="true"/);
    assert.match(enabled, /已跳过证书验证/);
    assert.match(enabled, /账号、密码和令牌有被截获的风险/);
    const error = module.exports.render(kind, false, '证书验证失败');
    assert.match(error, /aria-expanded="true"/);
    assert.match(error, /跳过证书验证/);
    assert.doesNotMatch(error, /已跳过证书验证/);
    assert.match(module.exports.render(kind, false, '连接超时'), /aria-expanded="false"/);
  }
});
