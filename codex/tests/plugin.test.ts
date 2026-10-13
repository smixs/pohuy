import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TIERS, readSettings, setTier, hook, promptTier, serverDataDirectory, dataDirectory, atomicWrite, updateSettings, styleContext, preferences } from '../src/core.js';
import { migrate, removeBlocks, removeReminder } from '../src/migration.js';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { Validator } from '@cfworker/json-schema';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'pohuy-test-'));

test('settings retain existing fields and reject corrupt data', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readSettings(dir).tier, 'full');
  assert.equal(existsSync(path.join(dir, 'settings.json')), false);
  writeFileSync(path.join(dir, 'settings.json'), '{"version":1,"tier":"lite","retained":42}');
  assert.equal(setTier(dir, 'off').retained, 42);
  writeFileSync(path.join(dir, 'settings.json'), '{broken');
  assert.throws(() => setTier(dir, 'full'));
  assert.equal(readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{broken');
});

test('hooks restore the saved mode after compaction and ignore commands inside task text', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const start = { hook_event_name: 'SessionStart', session_id: '../untrusted', source: 'compact' };
  assert.match(hook('SessionStart', start, dir, ROOT).hookSpecificOutput.additionalContext, /Стиль ответов: Pohuy/);
  for (const tier of TIERS) {
    setTier(dir, tier);
    const payload = { hook_event_name: 'UserPromptSubmit', session_id: '../untrusted', prompt: 'Continue the task.' };
    assert.match(hook('UserPromptSubmit', payload, dir, ROOT).hookSpecificOutput.additionalContext, new RegExp(`Pohuy mode: ${tier}`));
  }
  for (const data of ['"$pohuy full"', '```\n/pohuy ultra\n```', 'Explain /pohuy off', '$pohuy full\nDo a task']) assert.equal(promptTier(data), undefined);
  assert.equal(promptTier('$pohuy:pohuy normal'), 'off');
  assert.throws(() => hook('SessionStart', { ...start, session_id: '' }, dir, ROOT));
});

test('missing style prevents settings changes and hook errors do not block the chat', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  setTier(dir, 'off');
  assert.throws(() => hook('UserPromptSubmit', { hook_event_name: 'UserPromptSubmit', session_id: 'test', prompt: '/pohuy full' }, dir, dir));
  assert.equal(readSettings(dir).tier, 'off');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'codex/dist/controller.mjs'), '--data-dir', dir, 'hook', 'SessionStart'], { input: '{broken', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /could not load/);
  assert.notEqual(result.stderr, '');
});

test('server storage is determined independently of hook context and rejects arbitrary source layout', () => {
  const env = { PLUGIN_DATA: process.env.PLUGIN_DATA, POHUY_DATA_DIR: process.env.POHUY_DATA_DIR };
  delete process.env.PLUGIN_DATA; delete process.env.POHUY_DATA_DIR;
  try {
    const home = path.join(os.tmpdir(), 'pohuy-home', '.codex');
    assert.equal(serverDataDirectory(path.join(home, 'plugins', 'cache', 'created-by-me-remote', 'pohuy', '0.2.0')), path.join(home, 'plugins', 'data', 'pohuy-created-by-me-remote'));
    assert.throws(() => serverDataDirectory(ROOT));
    assert.throws(() => dataDirectory('relative'));
  } finally {
    for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('real MCP advertises native settings, validates updates, and shares mode with hooks without data_dir arguments', async t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const client = new Client({ name: 'pohuy-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'codex/dist/server.mjs')], env: { PATH: process.env.PATH ?? '', POHUY_DATA_DIR: dir }, stderr: 'pipe' });
  t.after(async () => client.close());
  await client.connect(transport);
  const caps = client.getServerCapabilities() as Record<string, any>;
  assert.deepEqual(caps.experimental['openai/settings'], { readTool: 'settings.read', updateTool: 'settings.update' });
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(t => t.name).sort(), ['pohuy.context', 'settings.read', 'settings.update']);
  assert.ok(tools.find(t => t.name === 'settings.read')?.outputSchema);
  const first = await client.callTool({ name: 'settings.read', arguments: {} });
  const settings = first.structuredContent as any;
  assert.equal(settings.values.mode, 'full');
  assert.equal(settings.values.answerLength, 'Кратко');
  assert.equal(settings.values.asciiDashes, false);
  assert.deepEqual(settings.schema.properties.mode.enum, ['Выключен', 'lite', 'full', 'ultra']);
  assert.equal(settings.layout.length, 4);
  assert.equal(settings.layout.flatMap((g: any) => g.items).some((item: any) => item.kind === 'tool'), false);
  assert.equal(settings.layout[0].items[0].property, 'mode');
  assert.equal(existsSync(path.join(dir, 'settings.json')), false);
  for (const tier of TIERS) {
    const mode = { off: 'Выключен', lite: 'lite', full: 'full', ultra: 'ultra' }[tier];
    const update = await client.callTool({ name: 'settings.update', arguments: { set: { mode } } });
    assert.equal((update.structuredContent as any).values.mode, mode);
    assert.equal(readSettings(dir).tier, tier);
    const context = await client.callTool({ name: 'pohuy.context', arguments: {} });
    assert.match((context.content as { text: string }[])[0].text, new RegExp(`Pohuy mode: ${tier}`));
    assert.match(hook('SessionStart', { hook_event_name: 'SessionStart', session_id: 'mcp' }, dir, ROOT).hookSpecificOutput.additionalContext, new RegExp(`Pohuy mode: ${tier}`));
  }
  await client.callTool({ name: 'settings.update', arguments: { set: { answerLength: 'Подробно', dryHumor: false } } });
  const changed = await client.callTool({ name: 'settings.update', arguments: { set: { mode: 'lite' } } });
  assert.equal((changed.structuredContent as any).values.answerLength, 'Подробно');
  assert.equal((changed.structuredContent as any).values.dryHumor, false);
  const detailed = await client.callTool({ name: 'pohuy.context', arguments: {} });
  assert.match((detailed.content as { text: string }[])[0].text, /Give thorough explanations/);
  await client.callTool({ name: 'settings.update', arguments: { set: { asciiDashes: true } } });
  const ascii = await client.callTool({ name: 'pohuy.context', arguments: {} });
  assert.equal((ascii.content as { text: string }[])[0].text.includes('—'), false);
  const before = readFileSync(path.join(dir, 'settings.json'));
  for (const args of [{ set: {} }, { set: { mode: 'invalid' } }, { set: { path: '/tmp/other' } }, { set: { mode: 'lite' }, data_dir: '/tmp/other' }, { set: { autoApply: 'false' } }]) {
    const result = await client.callTool({ name: 'settings.update', arguments: args });
    assert.equal(result.isError, true);
    assert.deepEqual(readFileSync(path.join(dir, 'settings.json')), before);
  }
  writeFileSync(path.join(dir, 'settings.json'), '{broken');
  assert.equal((await client.callTool({ name: 'settings.read', arguments: {} })).isError, true);
  assert.equal((await client.callTool({ name: 'settings.update', arguments: { set: { mode: 'full' } } })).isError, true);
  assert.equal(readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{broken');
});

test('partial preferences persist across mode changes and filter the context without editing sources', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = path.join(ROOT, 'skills/pohuy/SKILL.md'); const before = readFileSync(source);
  writeFileSync(path.join(dir, 'settings.json'), '{"version":1,"tier":"full","retained":42}');
  assert.deepEqual(preferences(readSettings(dir)), { autoApply: true, answerLength: 'short', dryHumor: true, workingDictionary: true, calibrationExamples: true, rhymingForms: true, ontology: false, asciiDashes: false });
  updateSettings(dir, { answerLength: 'detailed', dryHumor: false, workingDictionary: false, calibrationExamples: false, rhymingForms: false }, ROOT);
  setTier(dir, 'ultra');
  const settings = readSettings(dir);
  assert.equal(settings.retained, 42);
  assert.equal(settings.answerLength, 'detailed');
  const context = styleContext(settings.tier, ROOT, settings);
  assert.match(context, /Give thorough explanations/);
  assert.match(context, /without jokes or sarcasm/);
  assert.match(context, /Rhyming forms are disabled/);
  for (const heading of ['## Краткость', '## Словарь', '## Хуенитивы', '## Примеры калибровки']) assert.equal(context.includes(heading), false);
  assert.match(context, /## Ясность в критических ситуациях/);
  assert.match(context, /professional and free of profanity/);
  assert.deepEqual(readFileSync(source), before);
});

test('changing preferences without changing the mode reloads the next hook', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const start = { hook_event_name: 'SessionStart', session_id: 'preferences' };
  hook('SessionStart', start, dir, ROOT);
  const prompt = { hook_event_name: 'UserPromptSubmit', session_id: 'preferences', prompt: 'Continue the task.' };
  assert.equal(hook('UserPromptSubmit', prompt, dir, ROOT).hookSpecificOutput.additionalContext.includes('Стиль ответов: Pohuy'), false);
  updateSettings(dir, { answerLength: 'adaptive' }, ROOT);
  const refreshed = hook('UserPromptSubmit', prompt, dir, ROOT).hookSpecificOutput.additionalContext;
  assert.match(refreshed, /Стиль ответов: Pohuy/);
  assert.match(refreshed, /Match reply length to the task/);
  assert.equal(readSettings(dir).tier, 'full');
});

test('manual activation retains preferences and restricts rhyming to ultra', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  updateSettings(dir, { autoApply: false, rhymingForms: true }, ROOT);
  const prompt = { hook_event_name: 'UserPromptSubmit', session_id: 'manual', prompt: 'Continue the task.' };
  assert.match(hook('UserPromptSubmit', prompt, dir, ROOT).hookSpecificOutput.additionalContext, /Automatic Pohuy activation is disabled/);
  assert.equal(readSettings(dir).tier, 'full');
  assert.match(styleContext('full', ROOT, readSettings(dir)), /Rhyming forms are disabled/);
  const explicit = hook('UserPromptSubmit', { ...prompt, prompt: '/pohuy ultra' }, dir, ROOT).hookSpecificOutput.additionalContext;
  assert.match(explicit, /Rhyming forms are allowed in ultra mode/);
  assert.equal(readSettings(dir).autoApply, false);
  assert.match(hook('UserPromptSubmit', prompt, dir, ROOT).hookSpecificOutput.additionalContext, /Automatic Pohuy activation is disabled/);
});

test('migration previews without writes and removes only exact legacy content', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = Buffer.from('Before\r\n<!-- pohuy:start -->\r\nStyle\r\n<!-- pohuy:end -->\r\nAfter\r\n');
  writeFileSync(path.join(dir, 'AGENTS.md'), original);
  const payload = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Pohuy style is active. Remember to follow the specific guidelines of the Pohuy Style section in AGENTS.md.' } };
  const own = { type: 'command', command: `echo '${JSON.stringify(payload)}'` };
  const other = { type: 'command', command: 'echo "Keep Pohuy style is active in examples"' };
  const hooks = Buffer.from(JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [own, other], matcher: '*' }] } }));
  writeFileSync(path.join(dir, 'hooks.json'), hooks);
  assert.equal(migrate(dir).applied, false);
  assert.deepEqual(readFileSync(path.join(dir, 'AGENTS.md')), original);
  const result = migrate(dir, true);
  assert.equal(result.applied, true);
  assert.deepEqual(readFileSync(path.join(result.backup_dir!, 'AGENTS.md')), original);
  assert.equal(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'Before\r\nAfter\r\n');
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'hooks.json'), 'utf8')).hooks.UserPromptSubmit[0].hooks, [other]);
  assert.throws(() => removeBlocks(Buffer.from('<!-- pohuy:start -->\n')));
  assert.throws(() => removeReminder(Buffer.from('{broken')));
  assert.deepEqual(removeReminder(Buffer.from('{"hooks":{}}')), Buffer.from('{"hooks":{}}'));
});

test('migration validates every file before writes', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = '<!-- pohuy:start -->\nStyle\n<!-- pohuy:end -->\n';
  writeFileSync(path.join(dir, 'AGENTS.md'), original);
  writeFileSync(path.join(dir, 'hooks.json'), '{broken');
  assert.throws(() => migrate(dir, true));
  assert.equal(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), original);
});

test('migration refuses symlinks', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'target'), '<!-- pohuy:start -->\nStyle\n<!-- pohuy:end -->\n');
  try {
    symlinkSync(path.join(dir, 'target'), path.join(dir, 'AGENTS.md'));
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    t.skip('Windows does not permit file symlink creation.');
    return;
  }
  assert.throws(() => migrate(dir, true), /Миграция не заменяет символическую ссылку/);
});

test('migration restores the first file if the second write fails', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = Buffer.from('<!-- pohuy:start -->\nStyle\n<!-- pohuy:end -->\nKeep\n');
  writeFileSync(path.join(dir, 'AGENTS.md'), original);
  const reminder = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Pohuy style is active. Remember to follow the specific guidelines of the Pohuy Style section in AGENTS.md.' } };
  const hooks = Buffer.from(JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `echo '${JSON.stringify(reminder)}'` }] }] } }));
  writeFileSync(path.join(dir, 'hooks.json'), hooks);
  assert.throws(() => migrate(dir, true, (file, bytes, mode) => {
    if (file === path.join(dir, 'hooks.json')) throw new Error('Injected write failure.');
    atomicWrite(file, bytes, mode);
  }));
  assert.deepEqual(readFileSync(path.join(dir, 'AGENTS.md')), original);
  assert.deepEqual(readFileSync(path.join(dir, 'hooks.json')), hooks);
});

test('packages include runtime files and onboarding and reject existing destinations', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'plugin'); const archive = path.join(dir, 'plugin.zip');
  const command = [path.join(ROOT, 'codex/scripts/package.mjs'), destination, '--archive', archive];
  const result = spawnSync(process.execPath, command, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const files = unzipSync(readFileSync(archive));
  assert.ok(files['pohuy/plugin.json']);
  assert.ok(files['pohuy/skills/setup/SKILL.md']);
  assert.ok(files['pohuy/codex/skills/setup/SKILL.md']);
  assert.ok(files['pohuy/codex/dist/server.mjs']);
  assert.equal(Object.keys(files).some(f => /\.py$|node_modules|marketplace\.json/.test(f)), false);
  const before = readFileSync(archive);
  assert.notEqual(spawnSync(process.execPath, command).status, 0);
  assert.deepEqual(readFileSync(archive), before);
  const compat = path.join(dir, 'compat');
  assert.equal(spawnSync(process.execPath, [command[0], compat, '--compat']).status, 0);
  assert.equal(existsSync(path.join(compat, 'plugin.json')), false);
  assert.equal(existsSync(path.join(compat, '.codex-plugin/plugin.json')), true);
});

test('portable manifests satisfy the published Agent Plugins schemas', () => {
  for (const name of ['plugin', 'mcp']) {
    const schema = JSON.parse(readFileSync(path.join(ROOT, `codex/schemas/${name}.schema.json`), 'utf8'));
    const result = new Validator(schema, '2020-12').validate(JSON.parse(readFileSync(path.join(ROOT, `${name}.json`), 'utf8')));
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  }
});

test('Codex uses the Pi compiler and follows source edits without a second style document', async t => {
  const { loadStyleSource, buildStylePrompt } = await import('../../extensions/pohuy/style-source.js');
  const source = await loadStyleSource();
  assert.ok(styleContext('full', ROOT).startsWith(buildStylePrompt({ tier: 'full', selectedSections: source.options.filter(option => option.id !== 'huenitiv:rules').map(option => option.id) }, source)!));
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { cpSync } = await import('node:fs');
  cpSync(path.join(ROOT, 'skills'), path.join(dir, 'skills'), { recursive: true });
  const skill = path.join(dir, 'skills/pohuy/SKILL.md');
  const edited = readFileSync(skill, 'utf8').replace('Идиомы везде, где их сказал бы живой человек. Default.', 'SOURCE_LEVEL_POLICY. Default.');
  writeFileSync(skill, edited);
  assert.match(styleContext('full', dir), /SOURCE_LEVEL_POLICY/);
  assert.match(styleContext('full', dir, { version: 1, tier: 'full', ontology: true }), /# Онтология предметной области/);
  assert.doesNotMatch(styleContext('full', dir, { version: 1, tier: 'full', ontology: false }), /ontologia.md/);
  assert.equal(readFileSync(skill, 'utf8'), edited);
});

test('packaged style retains original source bytes and runs independently of the checkout', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'plugin');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'codex/scripts/package.mjs'), destination], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(path.join(destination, 'codex/style/SKILL.md')), readFileSync(path.join(ROOT, 'skills/pohuy/SKILL.md')));
  assert.equal(existsSync(path.join(destination, 'codex/AGENTS-pohuy.md')), false);
  const run = spawnSync(process.execPath, [path.join(destination, 'codex/dist/controller.mjs'), '--data-dir', path.join(dir, 'data'), 'set', 'ultra'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'data/settings.json'), 'utf8')).tier, 'ultra');
});

test('legacy installer uses the original skill and preserves surrounding instructions', { skip: process.platform === 'win32' }, t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'AGENTS.md'), 'Keep local instructions.\n');
  const result = spawnSync('bash', [path.join(ROOT, 'install-codex.sh')], { env: { ...process.env, CODEX_DIR: dir }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const instructions = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.match(instructions, /^Keep local instructions\./);
  assert.match(instructions, /Словарь \(рабочий минимум\)/);
  assert.doesNotMatch(instructions, /прочитай|pohuy\/SKILL.md/);
});

test('optional dash formatting changes prose only and leaves Markdown literals intact', async () => {
  const { formatPromptText } = await import('../src/prompt-text.js');
  const markdown = [
    'Text — explanation.', '`literal — value` and text — explanation.',
    '```ts', 'const value = "—";', '```', '> ~~~~', '> quoted — code', '> ~~~~',
    '    indented — code', '[link](https://example.test/—) and text — explanation.',
    '``multiline —', 'literal`` and text — explanation.',
  ].join('\n');
  assert.equal(formatPromptText(markdown), markdown);
  const formatted = formatPromptText(markdown, true);
  assert.match(formatted, /Text - explanation/);
  assert.match(formatted, /`literal — value` and text - explanation/);
  assert.match(formatted, /const value = "—"/);
  assert.match(formatted, /> quoted — code/);
  assert.match(formatted, /indented — code/);
  assert.match(formatted, /example.test\/—\) and text - explanation/);
  assert.match(formatted, /multiline —\nliteral`` and text - explanation/);
  assert.equal(formatPromptText(formatted, true), formatted);
});

test('selected references appear inline and dash changes reload hook context without editing sources', t => {
  const dir = temp(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourceFile = path.join(ROOT, 'skills/pohuy/references/ontologia.md');
  const original = readFileSync(sourceFile);
  const settings = { version: 1 as const, tier: 'full' as const, ontology: true };
  const baseline = styleContext('full', ROOT, settings);
  assert.match(baseline, /# Онтология предметной области/);
  assert.match(baseline, /### Легаси-археология/);
  assert.doesNotMatch(baseline, /прочитай выбранные источники/);
  assert.equal(baseline.includes('—'), true);
  const changed = styleContext('full', ROOT, { ...settings, asciiDashes: true });
  assert.equal(changed.includes('—'), false);
  assert.deepEqual(readFileSync(sourceFile), original);
  const event = { hook_event_name: 'UserPromptSubmit', session_id: 'dashes', prompt: 'Continue.' };
  hook('UserPromptSubmit', event, dir, ROOT);
  updateSettings(dir, { asciiDashes: true }, ROOT);
  const refreshed = hook('UserPromptSubmit', event, dir, ROOT).hookSpecificOutput.additionalContext;
  assert.match(refreshed, /Стиль ответов: Pohuy/);
  assert.equal(refreshed.includes('—'), false);
  assert.equal(hook('UserPromptSubmit', event, dir, ROOT).hookSpecificOutput.additionalContext.includes('—'), false);
  assert.equal(readSettings(dir).asciiDashes, true);
});
