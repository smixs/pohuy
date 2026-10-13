import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatPromptText } from './prompt-text.js';
import { parseStyleSource, buildStylePrompt, type StoredSettings } from '../../extensions/pohuy/style-source.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(moduleDirectory, '../..');
export const TIERS = ['off', 'lite', 'full', 'ultra'] as const;
export type Tier = typeof TIERS[number];
export type Settings = { version: 1; tier: Tier; [key: string]: unknown };
export type Preferences = {
  autoApply: boolean;
  answerLength: 'short' | 'adaptive' | 'detailed';
  dryHumor: boolean;
  workingDictionary: boolean;
  calibrationExamples: boolean;
  rhymingForms: boolean;
  ontology: boolean;
  asciiDashes: boolean;
};
export const DEFAULT_PREFERENCES: Preferences = {
  autoApply: true, answerLength: 'short', dryHumor: true,
  workingDictionary: true, calibrationExamples: true, rhymingForms: true, ontology: false, asciiDashes: false,
};
export function preferences(settings: Settings): Preferences {
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(result) as (keyof Preferences)[]) {
    const value = settings[key];
    if (value === undefined) continue;
    if (key === 'answerLength') {
      if (!['short', 'adaptive', 'detailed'].includes(value as string)) throw new Error('Некорректная настройка длины ответа.');
      result.answerLength = value as Preferences['answerLength'];
    } else {
      if (typeof value !== 'boolean') throw new Error(`Некорректная настройка: ${key}.`);
      result[key] = value;
    }
  }
  return result;
}
export const ARTIFACT_RULE = 'Apply Pohuy only to chat replies. Keep authored project artifacts professional and free of profanity. Preserve each artifact\'s established language, style, and terminology. Preserve literal values, quotations, examples, and translations. If an artifact already uses Russian, continue in Russian without a separate request. Use English when the artifact has no established language. Explicit language and localization requests take priority. Use neutral, literal wording for security warnings, irreversible actions, and recovery instructions.';

export function isTier(value: unknown): value is Tier {
  return TIERS.includes(value as Tier);
}

export function dataDirectory(explicit?: string): string {
  const value = explicit ?? process.env.PLUGIN_DATA ?? process.env.POHUY_DATA_DIR;
  if (!value || !path.isAbsolute(value)) throw new Error('Не задан абсолютный каталог данных плагина.');
  return path.resolve(value);
}

// Codex does not pass PLUGIN_DATA to bundled MCP processes in 0.162.1.
// Accept only its installed cache layout. Source checkouts need an explicit directory.
export function serverDataDirectory(root = ROOT): string {
  if (process.env.PLUGIN_DATA || process.env.POHUY_DATA_DIR) return dataDirectory();
  const version = path.basename(root);
  const plugin = path.dirname(root);
  const marketplace = path.dirname(plugin);
  const cache = path.dirname(marketplace);
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) || path.basename(plugin) !== 'pohuy' ||
      path.basename(cache) !== 'cache' || path.basename(path.dirname(cache)) !== 'plugins') {
    throw new Error('Сервер запущен вне установленного пакета. Задай POHUY_DATA_DIR.');
  }
  return path.join(path.dirname(cache), 'data', `pohuy-${path.basename(marketplace)}`);
}

export function readSettings(directory: string): Settings {
  let settings: unknown;
  try { settings = JSON.parse(readFileSync(path.join(directory, 'settings.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, tier: 'full' };
    throw new Error('Не удалось прочитать настройки Pohuy. Исправь файл до смены режима.', { cause: error });
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      (settings as Settings).version !== 1 || !isTier((settings as Settings).tier)) {
    throw new Error('Неподдерживаемый формат настроек Pohuy. Ожидается version: 1 и допустимый tier.');
  }
  preferences(settings as Settings);
  return settings as Settings;
}

export function atomicWrite(filename: string, bytes: string | Buffer, mode = 0o600): void {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', mode);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, filename);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function updateSettings(directory: string, patch: Partial<Preferences & { tier: Tier }>, root = ROOT): Settings {
  const settings: Settings = { ...readSettings(directory), ...patch };
  if (!isTier(settings.tier)) throw new Error('Неизвестный режим Pohuy.');
  preferences(settings);
  styleContext(settings.tier, root, settings);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  atomicWrite(path.join(directory, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return settings;
}

export function setTier(directory: string, tier: Tier): Settings {
  if (!isTier(tier)) throw new Error('Неизвестный режим Pohuy.');
  return updateSettings(directory, { tier });
}

export function loadSource(root = ROOT) {
  const packaged = path.join(root, 'codex/style/SKILL.md');
  const skill = readFileSync(existsSync(packaged) ? packaged : path.join(root, 'skills/pohuy/SKILL.md'), 'utf8');
  const reference = (name: string) => readFileSync(path.join(root, 'skills/pohuy/references', name + '.md'), 'utf8');
  return parseStyleSource({ skill, dictionary: reference('slovar'), scenes: reference('sceny'), huenitiv: reference('huenitiv') });
}

export function modeContext(tier: Tier, root = ROOT): string {
  const guidance = tier === 'off'
    ? 'Use ordinary chat without Pohuy styling.'
    : loadSource(root).tiers[tier].split('\n\n')[1];
  return `Pohuy mode: ${tier}. This supersedes earlier mode selections. ${guidance}\n${ARTIFACT_RULE}`;
}

export function preferenceContext(settings: Settings): string {
  const p = preferences(settings);
  const length = {
    short: 'Keep replies short: lead with the result and include only necessary details. Explicit requests for detail take precedence.',
    adaptive: 'Match reply length to the task. Keep answers to simple questions short. Explain reasoning and evidence when useful.',
    detailed: 'Give thorough explanations with reasoning, evidence, and useful examples. Keep the structure clear and follow explicit requests for brevity.',
  };
  return `Pohuy response preferences: ${length[p.answerLength]} ${p.dryHumor ? 'Use dry, situational irony when appropriate.' : 'Use direct, literal wording without jokes or sarcasm. Idiomatic engineering emphasis remains allowed.'} ${p.rhymingForms && settings.tier === 'ultra' ? 'Rhyming forms are allowed in ultra mode.' : 'Rhyming forms are disabled.'} These preferences take priority over conflicting chat examples. Keep project artifacts professional. Keep security warnings, irreversible actions, and recovery instructions clear.`;
}

export function styleContext(tier: Tier, root = ROOT, settings: Settings = { version: 1, tier }): string {
  if (tier === 'off') return modeContext(tier, root);
  const source = loadSource(root);
  const p = preferences(settings);
  const profile: StoredSettings = { tier };
  profile.selectedSections = source.options.filter(option =>
    (option.section === 'dictionary' && p.workingDictionary) ||
    (option.section === 'scenes' && p.calibrationExamples) ||
    (option.id.startsWith('skill:Словарь') && p.workingDictionary) ||
    (option.id === 'huenitiv:rules' && p.rhymingForms && tier === 'ultra')
  ).map(option => option.id);
  const ontology = p.ontology ? readFileSync(path.join(root, 'skills/pohuy/references/ontologia.md'), 'utf8') : '';
  const context = [buildStylePrompt(profile, source), ontology, modeContext(tier, root), preferenceContext({ ...settings, tier })].filter(Boolean).join('\n\n');
  return formatPromptText(context, p.asciiDashes);
}

export function promptTier(prompt: string): Tier | undefined {
  const match = /^(?:\/pohuy|\$pohuy(?::pohuy)?)\s+(off|normal|lite|full|ultra)$/.exec(prompt.trim());
  return match ? match[1] === 'normal' ? 'off' : match[1] as Tier : undefined;
}

export function hook(event: string, payload: Record<string, unknown>, directory: string, root = ROOT) {
  if (!['SessionStart', 'UserPromptSubmit'].includes(event) || payload.hook_event_name !== event ||
      typeof payload.session_id !== 'string' || !payload.session_id) throw new Error('Некорректное событие хука.');
  if (event === 'UserPromptSubmit' && typeof payload.prompt !== 'string') throw new Error('Некорректный prompt хука.');
  const sessionFile = path.join(directory, 'sessions', createHash('sha256').update(payload.session_id).digest('hex') + '.json');
  let previous: unknown;
  try { previous = JSON.parse(readFileSync(sessionFile, 'utf8')); } catch { previous = undefined; }
  const requested = event === 'UserPromptSubmit' ? promptTier(payload.prompt as string) : undefined;
  const settings = { ...readSettings(directory), ...(requested ? { tier: requested } : {}) };
  const tier = settings.tier;
  const p = preferences(settings);
  const fingerprint = createHash('sha256').update(JSON.stringify({ tier, ...p })).digest('hex');
  let context: string;
  if (!p.autoApply && !requested) context = modeContext('off') + '\nAutomatic Pohuy activation is disabled. Apply the saved profile only when the user invokes Pohuy explicitly in this turn.';
  else context = requested || event === 'SessionStart' || previous !== fingerprint ? styleContext(tier, root, settings) : modeContext(tier, root) + '\n' + preferenceContext(settings);
  if (requested) updateSettings(directory, { tier }, root);
  if (previous !== fingerprint || event === 'SessionStart') {
    mkdirSync(path.dirname(sessionFile), { recursive: true, mode: 0o700 });
    atomicWrite(sessionFile, JSON.stringify(fingerprint));
  }
  return { hookSpecificOutput: { hookEventName: event, additionalContext: formatPromptText(context, p.asciiDashes) } };
}
