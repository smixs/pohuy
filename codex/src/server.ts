import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readSettings, updateSettings, preferences, serverDataDirectory, styleContext, type Settings, type Tier, type Preferences } from './core.js';

const MODES = { 'Выключен': 'off', 'lite': 'lite', 'full': 'full', 'ultra': 'ultra' } as const;
const LENGTHS = { 'Кратко': 'short', 'По задаче': 'adaptive', 'Подробно': 'detailed' } as const;
function values(settings: Settings) {
  const p = preferences(settings);
  return { ...p,
    mode: Object.keys(MODES).find(key => MODES[key as keyof typeof MODES] === settings.tier) as keyof typeof MODES,
    answerLength: Object.keys(LENGTHS).find(key => LENGTHS[key as keyof typeof LENGTHS] === p.answerLength) as keyof typeof LENGTHS,
  };
}

export function createServer(directory: string, root = ROOT) {
  const manifest = JSON.parse(readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  const server = new McpServer({ name: 'pohuy-settings', version: manifest.version });
  const extensions = new OpenAIExtensions(server);
  extensions.settings.register({
    fields: {
      mode: {
        schema: z.enum(['Выключен', 'lite', 'full', 'ultra']),
        title: 'Уровень',
        description: 'Уровни из исходного скилла: lite, full и ultra. full включён по умолчанию.',
      },
      autoApply: { schema: z.boolean(), title: 'Pohuy с начала чата', description: 'Включено: стиль работает сразу. Выключено: применяй его к отдельному ответу командой /pohuy full.' },
      answerLength: { schema: z.enum(['Кратко', 'По задаче', 'Подробно']), title: 'Сколько подробностей', description: 'Кратко: сразу к делу. По задаче: сколько нужно для решения. Подробно: с объяснениями и примерами.' },
      dryHumor: { schema: z.boolean(), title: 'Шутки по делу', description: 'Можно подшутить над багом или ситуацией. Выключи, если сейчас нужен только разбор.' },
      workingDictionary: { schema: z.boolean(), title: 'Словарь', description: 'slovar.md: выражения для статусов, действий и оценок. Вместе с рабочим минимумом из скилла.' },
      calibrationExamples: { schema: z.boolean(), title: 'Сцены', description: 'sceny.md: примеры ответов на упавший деплой, странный баг и другие рабочие ситуации.' },
      rhymingForms: { schema: z.boolean(), title: 'Хуенитивы', description: 'huenitiv.md: рифмованные пары из исходника. Используются в ultra.' },
      asciiDashes: { schema: z.boolean(), title: 'Короткие тире', description: 'Необязательно: заменять длинное тире на дефис в тексте промпта. По умолчанию выключено.' },
      ontology: { schema: z.boolean(), title: 'Онтология', description: 'ontologia.md: авторская теория инженерного абсурда и её персонажи.' },
    },
    layout: [
      { kind: 'group', title: 'Режим Pohuy', items: [{ kind: 'property', property: 'mode' }, { kind: 'property', property: 'autoApply' }] },
      { kind: 'group', title: 'Как отвечать', items: [{ kind: 'property', property: 'answerLength' }, { kind: 'property', property: 'dryHumor' }] },
      { kind: 'group', title: 'Арсенал Pohuy', items: [{ kind: 'property', property: 'workingDictionary' }, { kind: 'property', property: 'calibrationExamples' }, { kind: 'property', property: 'rhymingForms' }, { kind: 'property', property: 'ontology' }] },
      { kind: 'group', title: 'Дополнительно', items: [{ kind: 'property', property: 'asciiDashes' }] },
    ],
    read: () => values(readSettings(directory)),
    update: (set) => {
      const { mode, answerLength, ...booleans } = set;
      const patch: Partial<Preferences & { tier: Tier }> = { ...booleans };
      if (mode !== undefined) patch.tier = MODES[mode];
      if (answerLength !== undefined) patch.answerLength = LENGTHS[answerLength];
      return values(updateSettings(directory, patch, root));
    },
  });
  server.registerTool('pohuy.context', {
    title: 'Применить текущий режим',
    description: 'Прочитать сохранённый режим и инструкции Pohuy для текущего чата. Вызови после настройки и при явном включении плагина.',
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const settings = readSettings(directory);
    return { content: [{ type: 'text', text: styleContext(settings.tier, root, settings) }], structuredContent: { tier: settings.tier, values: values(settings), scope: 'Будущие чаты этого плагина на текущем хосте.' } };
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await createServer(serverDataDirectory()).connect(new StdioServerTransport()); }
  catch (error) { console.error(`Pohuy: ${(error as Error).message}`); process.exitCode = 1; }
}
