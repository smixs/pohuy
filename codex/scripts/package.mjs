import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const FILES = [
  'plugin.json', 'mcp.json', '.codex-plugin/plugin.json', '.agents/plugins/marketplace.json',
  'assets/icon.svg', 'assets/icon.png', 'docs/assets/pohuy.webp', 'LICENSE',
  'codex/hooks/hooks.json', 'codex/mcp.json', 'codex/README.md',
  'codex/dist/controller.mjs', 'codex/dist/server.mjs', 'codex/dist/THIRD_PARTY_LICENSES.txt',
  'codex/skills/setup/SKILL.md', 'codex/skills/setup/agents/openai.yaml',
  'codex/skills/pohuy/SKILL.md', 'codex/skills/pohuy/agents/openai.yaml',
  ...['slovar', 'sceny', 'ontologia', 'huenitiv'].map(name => `skills/pohuy/references/${name}.md`),
];
export function packagePlugin(destination, archive, compat = false) {
  for (const file of FILES) if (!existsSync(path.join(root, file))) throw new Error(`Missing package file: ${file}`);
  if (existsSync(destination)) throw new Error('Каталог пакета уже существует.');
  if (archive && existsSync(archive)) throw new Error('Архив уже существует.');
  if (archive && !path.relative(destination, archive).startsWith('..')) throw new Error('Архив должен находиться вне каталога пакета.');
  mkdirSync(path.dirname(destination), { recursive: true });
  mkdirSync(destination);
  try {
    for (const file of FILES) {
      if (compat && ['plugin.json', 'mcp.json'].includes(file)) continue;
      const target = path.join(destination, file);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(root, file), target);
    }
    mkdirSync(path.join(destination, 'codex/style'), { recursive: true });
    cpSync(path.join(root, 'skills/pohuy/SKILL.md'), path.join(destination, 'codex/style/SKILL.md'));
    if (compat) {
      cpSync(path.join(destination, 'codex/mcp.json'), path.join(destination, '.mcp.json'));
      const overlayPath = path.join(destination, '.codex-plugin/plugin.json');
      const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
      overlay.mcpServers = './.mcp.json';
      writeFileSync(overlayPath, JSON.stringify(overlay, null, 2) + '\n');
    } else {
      cpSync(path.join(destination, 'codex/skills/setup'), path.join(destination, 'skills/setup'), { recursive: true });
      cpSync(path.join(destination, 'codex/skills/pohuy'), path.join(destination, 'skills/pohuy'), { recursive: true });
      const overlayPath = path.join(destination, '.codex-plugin/plugin.json');
      const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
      overlay.skills = './skills/';
      overlay.extensions['com.openai'].onboardingSkill = './skills/setup/SKILL.md';
      writeFileSync(overlayPath, JSON.stringify(overlay, null, 2) + '\n');
    }
    if (archive) {
      const files = Object.fromEntries(FILES.filter(file => file !== '.agents/plugins/marketplace.json' &&
        !(compat && ['plugin.json', 'mcp.json'].includes(file))).map(file => ['pohuy/' + file, readFileSync(path.join(destination, file))]));
      if (!compat) for (const skill of ['setup', 'pohuy']) for (const name of ['SKILL.md', 'agents/openai.yaml']) {
        const relative = `skills/${skill}/${name}`;
        files['pohuy/' + relative] = readFileSync(path.join(destination, relative));
      }
      files['pohuy/codex/style/SKILL.md'] = readFileSync(path.join(destination, 'codex/style/SKILL.md'));
      if (compat) files['pohuy/.mcp.json'] = readFileSync(path.join(destination, '.mcp.json'));
      writeFileSync(archive, zipSync(files), { flag: 'wx' });
    }
  } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const destination = args[0];
  const archiveIndex = args.indexOf('--archive');
  if (!destination || (archiveIndex >= 0 && !args[archiveIndex + 1])) throw new Error('Использование: node codex/scripts/package.mjs <новый каталог> [--archive <новый ZIP>] [--compat]');
  packagePlugin(path.resolve(destination), archiveIndex >= 0 ? path.resolve(args[archiveIndex + 1]) : undefined, args.includes('--compat'));
  console.log(`Пакет готов: ${path.resolve(destination)}`);
}
