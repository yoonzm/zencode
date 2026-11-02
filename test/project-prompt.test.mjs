import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('project prompts preserve legacy text, ignore its switch and respect explicit clearing', async () => {
  const result = await build({entryPoints: ['src/data/project-prompt.ts'], bundle: true, write: false, format: 'esm'});
  const {projectPromptOf, migrateProjectPrompt} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const legacy = {id: 'p', verify: {enabled: false, prompt: 'existing environment and tests'}};
  assert.deepEqual(migrateProjectPrompt(legacy), {id: 'p', projectPrompt: 'existing environment and tests'});
  assert.equal(projectPromptOf({projectPrompt: '', verify: legacy.verify}), '');
  assert.equal(projectPromptOf({projectPrompt: 'development rules', verify: legacy.verify}), 'development rules');
  assert.equal(projectPromptOf({}), '');
  assert.deepEqual(migrateProjectPrompt(migrateProjectPrompt(legacy)), migrateProjectPrompt(legacy));
});
