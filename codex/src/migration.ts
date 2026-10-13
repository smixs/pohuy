import { readFileSync, lstatSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { atomicWrite } from './core.js';

const REMINDER = 'Pohuy style is active. Remember to follow the specific guidelines of the Pohuy Style section in AGENTS.md.';

export function removeBlocks(bytes: Buffer): Buffer {
  const text = bytes.toString('latin1');
  const tokens = [...text.matchAll(/^<!-- pohuy:(start|end) -->\r?$/gm)];
  if (tokens.length !== [...text.matchAll(/<!-- pohuy:(?:start|end) -->/g)].length) throw new Error('Маркеры Pohuy должны занимать полные строки.');
  const ranges: [number, number][] = [];
  let start: number | undefined;
  for (const token of tokens) {
    if (token[1] === 'start' && start === undefined) start = token.index;
    else if (token[1] === 'end' && start !== undefined) {
      let end = token.index + token[0].length;
      if (text[end] === '\n') end++;
      ranges.push([start, end]);
      start = undefined;
    } else throw new Error('Маркеры Pohuy вложены или несбалансированы.');
  }
  if (start !== undefined) throw new Error('Нет закрывающего маркера Pohuy.');
  let result = bytes;
  for (const [start, end] of ranges.reverse()) result = Buffer.concat([result.subarray(0, start), result.subarray(end)]);
  return result;
}

export function isLegacyReminder(handler: Record<string, unknown>): boolean {
  if (handler.type !== 'command' || typeof handler.command !== 'string') return false;
  const match = /^\s*echo\s+(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\s*$/.exec(handler.command);
  if (!match) return false;
  const text = match[1] ?? match[2].replace(/\\(["\\$`])/g, '$1');
  try { return isDeepStrictEqual(JSON.parse(text), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: REMINDER } }); }
  catch { return false; }
}

export function removeReminder(bytes: Buffer): Buffer {
  const data = JSON.parse(bytes.toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (data.hooks !== undefined && (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)))) throw new Error('В hooks.json ожидается объект hooks.');
  const groups = data.hooks?.UserPromptSubmit ?? [];
  if (!Array.isArray(groups)) throw new Error('UserPromptSubmit должен содержать массив.');
  let changed = false;
  const remaining = groups.flatMap((group) => {
    if (!group || typeof group !== 'object' || !Array.isArray(group.hooks) ||
        group.hooks.some((h: unknown) => !h || typeof h !== 'object' || Array.isArray(h))) throw new Error('Некорректная группа хуков.');
    const hooks = group.hooks.filter((h: Record<string, unknown>) => !isLegacyReminder(h));
    if (hooks.length === group.hooks.length) return [group];
    changed = true;
    return hooks.length ? [{ ...group, hooks }] : [];
  });
  if (!changed) return bytes;
  data.hooks.UserPromptSubmit = remaining;
  return Buffer.from(JSON.stringify(data, null, 2) + '\n');
}

export function migrate(home: string, apply = false, write = atomicWrite) {
  const changes: { filename: string; original: Buffer; updated: Buffer; mode: number }[] = [];
  for (const [name, transform] of [['AGENTS.md', removeBlocks], ['hooks.json', removeReminder]] as const) {
    const filename = path.join(home, name);
    let stat;
    try { stat = lstatSync(filename); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Миграция не заменяет символическую ссылку: ${filename}`);
    const original = readFileSync(filename);
    const updated = transform(original);
    if (!original.equals(updated)) changes.push({ filename, original, updated, mode: stat.mode & 0o777 });
  }
  const result = { applied: false, changed_files: changes.map(c => c.filename), backup_dir: null as string | null };
  if (!apply || !changes.length) return result;
  const backup = path.join(home, 'pohuy-migration-backups', `${new Date().toISOString().replaceAll(':', '')}-${randomUUID()}`);
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const c of changes) write(path.join(backup, path.basename(c.filename)), c.original);
  const installed: typeof changes = [];
  try {
    for (const c of changes) {
      if (lstatSync(c.filename).isSymbolicLink() || !readFileSync(c.filename).equals(c.original)) throw new Error(`Файл изменился во время миграции: ${c.filename}`);
      write(c.filename, c.updated, c.mode);
      installed.push(c);
    }
  } catch (error) {
    const failures: string[] = [];
    for (const c of installed.reverse()) {
      try { write(c.filename, c.original, c.mode); } catch (e) { failures.push((e as Error).message); }
    }
    throw new Error(`Миграция не завершена: ${(error as Error).message}. Резервные копии: ${backup}. ${failures.join('; ')}`);
  }
  return { ...result, applied: true, backup_dir: backup };
}
