import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dataDirectory, hook, readSettings, setTier, styleContext, isTier, ARTIFACT_RULE } from './core.js';
import { migrate } from './migration.js';

const args = process.argv.slice(2);
const dataIndex = args.indexOf('--data-dir');
const explicit = dataIndex >= 0 ? args.splice(dataIndex, 2)[1] : undefined;
const [command, value] = args;
try {
  let result: unknown;
  if (command === 'migrate') {
    const homeIndex = args.indexOf('--codex-home');
    const home = homeIndex >= 0 ? args[homeIndex + 1] : process.env.CODEX_HOME ?? process.env.CODEX_DIR ?? path.join(os.homedir(), '.codex');
    if (!home) throw new Error('Не задан каталог Codex.');
    result = migrate(path.resolve(home), args.includes('--apply'));
  } else {
    const directory = dataDirectory(explicit);
    if (command === 'hook') result = hook(value, JSON.parse(readFileSync(0, 'utf8')), directory);
    else if (command === 'status') result = { tier: readSettings(directory).tier };
    else if (command === 'set') {
      const tier = value === 'normal' ? 'off' : value;
      if (!isTier(tier)) throw new Error('Допустимые режимы: off, lite, full, ultra.');
      const context = styleContext(tier, undefined, { ...readSettings(directory), tier });
      result = { saved: true, tier: setTier(directory, tier).tier, context };
    } else throw new Error('Команды: status, set <режим>, hook <событие>, migrate [--apply].');
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`Pohuy: ${(error as Error).message}`);
  if (command === 'hook') console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: value, additionalContext: 'Pohuy could not load its settings or style. Use ordinary chat and report the hook error. ' + ARTIFACT_RULE } }));
  else process.exitCode = 1;
}
