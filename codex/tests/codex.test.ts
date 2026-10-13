import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CODEX = process.env.POHUY_TEST_CODEX ?? 'codex';
const available = spawnSync(CODEX, ['--version']).status === 0;

class AppServer {
  child;
  sequence = 0;
  notifications: { method: string; params: any }[] = [];
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  constructor(env: NodeJS.ProcessEnv, cwd: string) {
    this.child = spawn(CODEX, ['app-server', '--stdio'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', line => {
      const message = JSON.parse(line);
      if (message.method) this.notifications.push(message);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result);
    });
    this.child.on('exit', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('App server exited.')); }
      this.pending.clear();
    });
  }
  call(method: string, params: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async waitFor(method: string) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const message = this.notifications.find(n => n.method === method);
      if (message) return message.params;
      await delay(25);
    }
    throw new Error(`No notification: ${method}`);
  }
  close() {
    if (process.platform === 'win32' && this.child.pid) {
      // Keep the parent alive until taskkill finds its MCP children.
      spawnSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { timeout: 5000, stdio: 'ignore' });
    } else {
      this.child.stdin.end(); this.child.kill();
    }
  }
}

test('Codex executes installed hooks and sends their style context to the model', { skip: !available, timeout: 60000 }, async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pohuy codex '));
  let app: AppServer | undefined;
  let model: ReturnType<typeof createServer> | undefined;
  t.after(() => {
    model?.closeAllConnections(); model?.close();
    app?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const market = path.join(dir, 'market'); const home = path.join(dir, 'home');
  mkdirSync(home); writeFileSync(path.join(home, 'config.toml'), '[features]\nhooks = true\n');
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home };
  delete env.PLUGIN_DATA; delete env.POHUY_DATA_DIR;
  for (const [command, args] of [
    [process.execPath, [path.join(ROOT, 'codex/scripts/package.mjs'), market, '--compat']],
    [CODEX, ['plugin', 'marketplace', 'add', market]],
    [CODEX, ['plugin', 'add', 'pohuy@pohuy', '--json']],
  ] as const) {
    const result = spawnSync(command, [...args], { env, cwd: dir, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
  }
  app = new AppServer(env, dir);
  await app.call('initialize', { clientInfo: { name: 'pohuy-test', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  const result = await app.call('hooks/list', { cwds: [dir] });
  const hooks = result.data.flatMap((item: any) => item.hooks);
  assert.equal(hooks.length, 2, JSON.stringify(result));
  assert.ok(hooks.every((h: any) => h.handlerType === 'command' && h.command.startsWith('node ')));
  const detail = (await app.call('plugin/read', { marketplacePath: path.join(market, '.agents/plugins/marketplace.json'), pluginName: 'pohuy' })).plugin;
  assert.equal(detail.onboardingSkill.name, 'pohuy:setup');
  assert.equal(detail.onboardingSkill.enabled, true);
  await app.call('config/batchWrite', {
    edits: hooks.map((h: any) => ({ keyPath: `hooks.state.${JSON.stringify(h.key)}.trusted_hash`, value: h.currentHash, mergeStrategy: 'upsert' })),
    reloadUserConfig: true,
  });
  const requests: string[] = [];
  model = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(Buffer.concat(chunks).toString('utf8'));
    // Stop after capturing the real model request. This test does not call a model service.
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'End of hook test', type: 'invalid_request_error' } }));
  });
  await new Promise<void>(resolve => model!.listen(0, '127.0.0.1', resolve));
  const thread = (await app.call('thread/start', { cwd: dir, ephemeral: true, config: {
    'features.apps': false,
    model_provider: 'pohuy-test', model: 'diagnostic',
    'model_providers.pohuy-test': {
      name: 'Pohuy test', base_url: `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`,
      wire_api: 'responses', requires_openai_auth: false, request_max_retries: 0, stream_max_retries: 0,
    },
  } })).thread.id;
  let servers = await app.call('mcpServerStatus/list', { threadId: thread });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const status = servers.data.find((s: any) => s.name === 'pohuy-settings')?.runtimeStatus;
    if (status != null && status !== 'notStarted' && status !== 'starting') break;
    await delay(100);
    servers = await app.call('mcpServerStatus/list', { threadId: thread });
  }
  assert.equal(servers.data.find((s: any) => s.name === 'pohuy-settings')?.runtimeStatus, 'connected', JSON.stringify(servers));
  const resultRead = await app.call('mcpServer/tool/call', { threadId: thread, server: 'pohuy-settings', tool: 'settings.read', arguments: {} });
  assert.equal(resultRead.structuredContent.values.mode, 'full');
  assert.equal(resultRead.structuredContent.layout.length, 4);
  const update = await app.call('mcpServer/tool/call', { threadId: thread, server: 'pohuy-settings', tool: 'settings.update', arguments: { set: { mode: 'lite' } } });
  assert.equal(update.structuredContent.values.mode, 'lite');
  await app.call('turn/start', { threadId: thread, input: [{ type: 'text', text: 'Reply OK.' }] });
  await app.waitFor('turn/completed');
  const runs = app.notifications.filter(n => n.method === 'hook/completed').map(n => n.params.run);
  assert.deepEqual(runs.map(r => [r.eventName, r.status]), [['sessionStart', 'completed'], ['userPromptSubmit', 'completed']]);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /Стиль ответов: Pohuy/);
  assert.match(requests[0], /Pohuy mode: lite/);
});
