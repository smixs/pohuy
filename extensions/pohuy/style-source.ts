import { readFile } from "node:fs/promises";

export type Tier = "lite" | "full" | "ultra";
export type StoredTier = Tier | "normal";
export type JsonObject = Record<string, unknown>;

export const TIERS = ["lite", "full", "ultra"] as const;
const PROMPT_START = "<!-- POHUY:START -->";
const PROMPT_END = "<!-- POHUY:END -->";
const SKILL_PATH = new URL("../../skills/pohuy/SKILL.md", import.meta.url);
const SLOVAR_PATH = new URL("../../skills/pohuy/references/slovar.md", import.meta.url);
const SCENES_PATH = new URL("../../skills/pohuy/references/sceny.md", import.meta.url);
const HUENITIV_PATH = new URL("../../skills/pohuy/references/huenitiv.md", import.meta.url);
const HUENITIV_OPTION_ID = "huenitiv:rules";
const LEGACY_HUENITIV_OPTION_ID = "skill:Хуенитивы";
const CORE_SKILL_SECTIONS = [
  "Persistence",
  "Правила",
  "Шкала состояний проекта",
  "Auto-Clarity (мат выключается)",
  "Boundaries",
] as const;
const OPTIONAL_SKILL_SECTIONS = [
  "Словарь (рабочий минимум)",
] as const;
const SCENE_FRAMING =
  "Сцены задают тон, а не готовый текст. Не цитируй их дословно. Адаптируй к ситуации.";
const DEFAULT_ULTRA_SCENES = [
  "Легаси-археология",
  "Каскадный отказ",
  "Триумф после долгого дебага",
] as const;
export const SETTINGS_SECTIONS = ["general", "skill", "dictionary", "scenes"] as const;
export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: "Общие",
  skill: "Skill",
  dictionary: "Словарь",
  scenes: "Сцены",
};
const NON_OPTIONAL_DICTIONARY_PREFIXES = ["Чего в словаре нет"] as const;
const DICTIONARY_DESCRIPTIONS: Record<string, string> = {
  "Состояния и статусы": "Слова для описания состояния проекта, от штатной работы до полного отказа.",
  "Действия": "Глаголы для работы, ошибок, исправлений, ожидания и бесполезной возни.",
  "Оценки и количества": "Слова для масштаба, количества, уверенности и значимости.",
  "Сущности": "Названия для кода, артефактов, процессов и прочих технических сущностей.",
};

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export type StoredSettings = {
  tier: StoredTier;
  skillEnabled?: boolean;
  selectedSections?: string[];
  itemOverrides?: Record<string, boolean>;
};
export type SettingsPatch = {
  tier?: StoredTier;
  skillEnabled?: boolean;
  selectedSections?: string[] | null;
  itemOverrides?: Record<string, boolean> | null;
};
export type SourceOption = {
  id: string;
  section: Exclude<SettingsSection, "general">;
  label: string;
  description: string;
  content: string;
  path: string;
  line: number;
  nodes: ConfigNode[];
};
export type NodeKind = "group" | "entry" | "scene" | "component" | "setting";
export type ConfigNode = {
  id: string;
  kind: NodeKind;
  section: SettingsSection;
  label: string;
  description: string;
  markdown: string;
  path: string;
  line: number;
  aliases: string[];
  children: ConfigNode[];
  optionId?: string;
  category?: string;
};
export type StyleSource = {
  common: string[];
  tiers: Record<Tier, string>;
  options: SourceOption[];
  roots: Record<Exclude<SettingsSection, "general">, ConfigNode[]>;
};
export type SourceDocuments = {
  skill: string;
  dictionary: string;
  scenes: string;
  huenitiv: string;
};

const WORKING_MINIMUM_OVERLAPS: Record<string, string> = {
  [sourceId("slovar", "Состояния и статусы")]: "Состояние:",
  [sourceId("slovar", "Действия")]: "Действия:",
  [sourceId("slovar", "Оценки и количества")]: "Связки и оценки:",
  [sourceId("slovar", "Сущности")]: "Сущности:",
};
const WORKING_MINIMUM_LABELS = [...Object.values(WORKING_MINIMUM_OVERLAPS), "Присказки"];

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

function extractHeadingSection(markdown: string, depth: number, heading: string, source: string): string {
  const lines = markdown.split("\n");
  const marker = `${"#".repeat(depth)} ${heading}`;
  const start = lines.findIndex((line) => line.trimEnd() === marker);
  if (start === -1) throw new Error(`В ${source} нет раздела: ${heading}`);

  const next = lines.findIndex((line, index) => {
    if (index <= start) return false;
    const match = line.match(/^(#{1,6})\s/);
    return match !== null && match[1].length <= depth;
  });
  const body = lines.slice(start + 1, next === -1 ? undefined : next).join("\n").trim();
  if (!body) throw new Error(`Empty ${source} section: ${heading}`);
  return `${marker}\n\n${body}`;
}

function extractSkillSection(markdown: string, heading: string): string {
  return extractHeadingSection(markdown, 2, heading, "SKILL.md");
}

function headingsAtDepth(markdown: string, depth: number): string[] {
  const prefix = `${"#".repeat(depth)} `;
  return markdown
    .split("\n")
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}#`))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
}

function requiredHeadingWithPrefix(markdown: string, depth: number, prefix: string): string {
  const heading = headingsAtDepth(markdown, depth).find((candidate) => candidate.startsWith(prefix));
  if (!heading) throw new Error(`Нет заголовка, начинающегося с: ${prefix}`);
  return heading;
}

function sourceId(source: "skill" | "slovar" | "sceny", heading: string): string {
  return `${source}:${heading}`;
}

function plainMarkdownText(text: string): string {
  return text
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function firstContentBlock(content: string): string {
  const lines = content.split("\n").slice(1);
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1) return "";
  const endOffset = lines.slice(start).findIndex((line) => line.trim() === "");
  const end = endOffset === -1 ? lines.length : start + endOffset;
  return plainMarkdownText(lines.slice(start, end).join("\n"));
}

function headingLine(markdown: string, depth: number, heading: string): number {
  const marker = `${"#".repeat(depth)} ${heading}`;
  const index = markdown.split("\n").findIndex((line) => line.trimEnd() === marker);
  return index < 0 ? 1 : index + 1;
}

function stableNodeId(_source: string, optionId: string, _line: number, label: string): string {
  return `item:${optionId}:${label.toLocaleLowerCase("ru-RU")}`;
}

function entryLabel(markdown: string): string {
  const bold = markdown.match(/^\s*-\s+\*\*([^*]+)\*\*/);
  if (bold) return bold[1].trim();
  const quoted = markdown.match(/^\s*-\s+[«"]([^»"]+)[»"]/);
  if (quoted) return quoted[1].trim();
  return plainMarkdownText(markdown).split(/\s+[—–-]\s+/)[0].trim();
}

function entryDescription(markdown: string): string {
  const plain = plainMarkdownText(markdown);
  const separator = plain.match(/\s+[—–-]\s+/);
  return separator ? plain.slice((separator.index ?? 0) + separator[0].length).trim() : plain;
}

function parseDictionaryNodes(
  optionId: string,
  heading: string,
  sectionContent: string,
  sectionLine: number,
  section: "skill" | "dictionary" = "dictionary",
  path = "references/slovar.md",
): ConfigNode[] {
  const lines = sectionContent.split("\n");
  const root: ConfigNode = {
    id: `group:${optionId}`,
    kind: "group",
    section,
    label: heading,
    description: DICTIONARY_DESCRIPTIONS[heading] ?? firstContentBlock(sectionContent),
    markdown: sectionContent,
    path,
    line: sectionLine,
    aliases: [],
    children: [],
    optionId,
  };
  let parent = root;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const subgroup = line.match(/^([^#*`].+):\s*$/);
    const nextContent = lines.slice(index + 1).find((candidate) => candidate.trim() !== "");
    if (subgroup && nextContent && /^\s*-\s+/.test(nextContent)) {
      const label = subgroup[1].trim();
      parent = {
        id: stableNodeId("slovar", optionId, sectionLine + index, label),
        kind: "group",
        section,
        label,
        description: `Подгруппа раздела "${heading}".`,
        markdown: line,
        path,
        line: sectionLine + index,
        aliases: [],
        children: [],
        optionId,
      };
      root.children.push(parent);
      continue;
    }
    if (!/^\s*-\s+/.test(line)) continue;
    const block = [line];
    while (index + 1 < lines.length && !/^\s*-\s+/.test(lines[index + 1]) && !/^\S.+:\s*$/.test(lines[index + 1])) {
      if (lines[index + 1].trim() === "" && (index + 2 >= lines.length || !/^\s{2,}\S/.test(lines[index + 2]))) break;
      block.push(lines[index + 1]);
      index += 1;
    }
    const markdown = block.join("\n").trimEnd();
    const label = entryLabel(markdown);
    parent.children.push({
      id: stableNodeId("slovar", optionId, sectionLine + index - block.length + 1, label),
      kind: "entry",
      section,
      label,
      description: entryDescription(markdown),
      markdown,
      path,
      line: sectionLine + index - block.length + 1,
      aliases: label.split(/\s*\/\s*/).filter((alias) => alias !== label),
      children: [],
      optionId,
    });
  }
  return [root];
}

function sourceOption(
  source: "skill" | "slovar" | "sceny",
  heading: string,
  content: string,
  fullSource: string,
): SourceOption {
  const depth = source === "sceny" ? 3 : 2;
  const path = source === "skill"
    ? "SKILL.md"
    : source === "slovar"
      ? "references/slovar.md"
      : "references/sceny.md";
  const line = headingLine(fullSource, depth, heading);
  const id = sourceId(source, heading);
  return {
    id,
    section: source === "skill" ? "skill" : source === "slovar" ? "dictionary" : "scenes",
    label: heading,
    description: source === "slovar"
      ? DICTIONARY_DESCRIPTIONS[heading] ?? firstContentBlock(content)
      : firstContentBlock(content),
    content,
    path,
    line,
    nodes: source === "slovar"
      ? parseDictionaryNodes(id, heading, content, line)
      : source === "skill"
        ? parseDictionaryNodes(id, heading, content, line, "skill", "SKILL.md")
        : [],
  };
}

function huenitivOption(content: string): SourceOption {
  return {
    id: HUENITIV_OPTION_ID,
    section: "skill",
    label: "Хуенитивы",
    description: "Правила рифмованных замен через дефис. По умолчанию включены в ultra, но доступны в любом активном режиме.",
    content: compileRuntimeMarkdown(content).replace(/ Только в режиме \*\*ultra\*\*\./u, ""),
    path: "references/huenitiv.md",
    line: 1,
    nodes: [],
  };
}

function extractTierPolicy(levels: string, examplesSource: string, tier: Tier): string {
  const tableRow = levels.split("\n").find((line) => line.startsWith(`| **${tier}** |`));
  if (!tableRow) throw new Error(`В таблице SKILL.md нет режима: ${tier}`);
  const description = tableRow.split("|")[2]?.trim().replace(/\s+Default\.$/u, "");
  if (!description) throw new Error(`В таблице SKILL.md нет описания режима: ${tier}`);

  const examples: string[] = [];
  const exampleLines = examplesSource.split("\n");
  for (let index = 0; index < exampleLines.length; index += 1) {
    if (!exampleLines[index].startsWith(`- ${tier}:`)) continue;
    const block = [exampleLines[index]];
    while (index + 1 < exampleLines.length && /^\s{2,}\S/.test(exampleLines[index + 1])) {
      block.push(exampleLines[index + 1]);
      index += 1;
    }
    examples.push(block.join("\n").replace(new RegExp(`^- ${tier}:`), "-"));
  }
  if (examples.length === 0) throw new Error(`В SKILL.md нет примеров для режима: ${tier}`);

  return [`## Уровень: ${tier}`, description, `Примеры:\n${examples.join("\n")}`].join("\n\n");
}

function compileRuntimeMarkdown(markdown: string): string {
  return markdown
    .replace(/^## Persistence$/gmu, "## Постоянство стиля")
    .replace(/^## Auto-Clarity \(мат выключается\)$/gmu, "## Ясность в критических ситуациях")
    .replace(/^## Boundaries$/gmu, "## Границы")
    .replace(/^- Security-предупреждения$/gmu, "- Предупреждения безопасности")
    .replace(/^Default:.*$/gmu, "")
    .replace(/ Выключение только: «нормальный режим» \/ «хватит материться»\.$/gmu, "")
    .replace(/ «нормальный режим» — выключение\.$/gmu, "")
    .replace(/^Уровень держится до смены или конца сессии\.\s*$/gmu, "")
    .replace(/\s+Полные примеры по каждой — в `references\/sceny\.md`\./gu, "")
    .replace(/^Полная версия с маппингами — в `references\/slovar\.md`\.\s*$/gmu, "")
    .replace(/^Полный арсенал образности — в `references\/slovar\.md`\.\s*$/gmu, "")
    .replace(/\s+Теория — в `ontologia\.md`\./gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sceneCategory(markdown: string, sceneLine: number): string {
  let category = "Сцены";
  for (const [index, line] of markdown.split("\n").entries()) {
    if (index + 1 >= sceneLine) break;
    const match = line.match(/^##\s+(.+)$/);
    if (match) category = match[1].trim();
  }
  return category;
}

function buildSourceRoots(options: SourceOption[], documents: SourceDocuments): StyleSource["roots"] {
  const skillOptions = options.filter((option) => option.section === "skill");
  const huenitiv = skillOptions.find((option) => option.id === HUENITIV_OPTION_ID);
  const dictionaryOptions = options.filter((option) => option.section === "dictionary");
  const sceneOptions = options.filter((option) => option.section === "scenes");
  const skillRoot: ConfigNode = {
    id: "component:style-skill",
    kind: "component",
    section: "skill",
    label: "Стилевой skill",
    description: "Подключает правила ответа из SKILL.md. Словарь, сцены и хуенитивы включаются отдельно.",
    markdown: documents.skill,
    path: "SKILL.md",
    line: 1,
    aliases: ["pohuy", "style"],
    children: [],
  };
  for (const option of skillOptions.filter((candidate) => candidate.id !== HUENITIV_OPTION_ID)) {
    skillRoot.children.push({
      id: `component:${option.id}`,
      kind: "group",
      section: "skill",
      label: option.label,
      description: option.description,
      markdown: option.content,
      path: option.path,
      line: option.line,
      aliases: [],
      children: option.nodes[0]?.children ?? [],
      optionId: option.id,
    });
  }
  const dictionaryResource: ConfigNode = {
    id: "component:dictionary-resource",
    kind: "component",
    section: "skill",
    label: "Рабочий словарь",
    description: "Слова и выражения из references/slovar.md. Их можно включать по одному или группами.",
    markdown: documents.dictionary,
    path: "references/slovar.md",
    line: 1,
    aliases: ["dictionary", "словарь"],
    children: [],
  };
  const scenesResource: ConfigNode = {
    id: "component:scenes-resource",
    kind: "component",
    section: "skill",
    label: "Сцены",
    description: "Примеры ответов для состояний проекта и типичных ситуаций.",
    markdown: documents.scenes,
    path: "references/sceny.md",
    line: 1,
    aliases: ["scenes", "сцены"],
    children: [],
  };

  const huenitivResource: ConfigNode | undefined = huenitiv && {
    id: "component:huenitiv-resource",
    kind: "component",
    section: "skill",
    label: huenitiv.label,
    description: huenitiv.description,
    markdown: documents.huenitiv,
    path: huenitiv.path,
    line: huenitiv.line,
    aliases: ["huenitiv", "хуенитив", "рифма"],
    children: [],
    optionId: huenitiv.id,
  };

  const sceneGroups = new Map<string, ConfigNode>();
  for (const option of sceneOptions) {
    const category = option.nodes[0]?.category ?? "Сцены";
    let group = sceneGroups.get(category);
    if (!group) {
      group = {
        id: `scene-group:${category}`,
        kind: "group",
        section: "scenes",
        label: category,
        description: category === "Шкала состояний проекта"
          ? "Десять состояний проекта: от триумфа до катастрофы."
          : "Примеры ответов для типичных ситуаций.",
        markdown: "",
        path: "references/sceny.md",
        line: option.line,
        aliases: [],
        children: [],
        category,
      };
      sceneGroups.set(category, group);
    }
    group.children.push(...option.nodes);
  }
  return {
    skill: [skillRoot, dictionaryResource, scenesResource, ...(huenitivResource ? [huenitivResource] : [])],
    dictionary: dictionaryOptions.flatMap((option) => option.nodes),
    scenes: [...sceneGroups.values()],
  };
}

export async function loadStyleSource(): Promise<StyleSource> {
  const [skill, slovar, scenes, huenitiv] = await Promise.all([
    readFile(SKILL_PATH, "utf8"),
    readFile(SLOVAR_PATH, "utf8"),
    readFile(SCENES_PATH, "utf8"),
    readFile(HUENITIV_PATH, "utf8"),
  ]);
  return parseStyleSource({ skill, dictionary: slovar, scenes, huenitiv });
}

export function parseStyleSource({ skill, dictionary: slovar, scenes, huenitiv }: SourceDocuments): StyleSource {
  const levels = extractSkillSection(skill, "Уровни");
  const nonOptionalDictionaryHeading = requiredHeadingWithPrefix(
    slovar,
    2,
    NON_OPTIONAL_DICTIONARY_PREFIXES[0],
  );
  const common = [
    ...CORE_SKILL_SECTIONS.map((heading) => compileRuntimeMarkdown(extractSkillSection(skill, heading))),
    compileRuntimeMarkdown(extractHeadingSection(slovar, 2, nonOptionalDictionaryHeading, "slovar.md")),
    SCENE_FRAMING,
  ];
  const options = [
    ...OPTIONAL_SKILL_SECTIONS.map((heading) =>
      sourceOption("skill", heading, extractSkillSection(skill, heading), skill)
    ),
    huenitivOption(huenitiv),
    ...headingsAtDepth(slovar, 2)
      .filter((heading) =>
        !NON_OPTIONAL_DICTIONARY_PREFIXES.some((prefix) => heading.startsWith(prefix))
      )
      .map((heading) =>
        sourceOption("slovar", heading, extractHeadingSection(slovar, 2, heading, "slovar.md"), slovar)
      ),
    ...headingsAtDepth(scenes, 3).map((heading) => {
      const option = sourceOption("sceny", heading, extractHeadingSection(scenes, 3, heading, "sceny.md"), scenes);
      const category = sceneCategory(scenes, option.line);
      option.nodes = [{
        id: `scene:${option.id}`,
        kind: "scene",
        section: "scenes",
        label: heading,
        description: option.description,
        markdown: option.content,
        path: option.path,
        line: option.line,
        aliases: [],
        children: [],
        optionId: option.id,
        category,
      }];
      return option;
    }),
  ];

  const source: StyleSource = {
    common,
    options,
    roots: buildSourceRoots(options, {
      skill,
      dictionary: slovar,
      scenes,
      huenitiv,
    }),
    tiers: Object.fromEntries(
      TIERS.map((tier) => [tier, extractTierPolicy(levels, skill, tier)]),
    ) as Record<Tier, string>,
  };
  assertDefaultSections(source);
  return source;
}

function defaultSectionIds(tier: StoredTier): string[] {
  if (tier === "lite" || tier === "normal") return [];
  const full = OPTIONAL_SKILL_SECTIONS.map((heading) => sourceId("skill", heading));
  if (tier === "full") return full;
  return [
    ...full,
    HUENITIV_OPTION_ID,
    sourceId("slovar", "Образность: восклицания, звукопись, присказки"),
    ...DEFAULT_ULTRA_SCENES.map((heading) => sourceId("sceny", heading)),
  ];
}

function assertDefaultSections(source: StyleSource): void {
  const known = new Set(source.options.map((option) => option.id));
  const required = new Set([
    ...defaultSectionIds("full"),
    ...defaultSectionIds("ultra"),
  ]);
  const missing = [...required].filter((id) => !known.has(id));
  if (missing.length > 0) throw new Error(`Не найдены стандартные разделы: ${missing.join(", ")}`);
}

function canonicalSectionId(id: string): string {
  return id === LEGACY_HUENITIV_OPTION_ID ? HUENITIV_OPTION_ID : id;
}

export function selectedSectionIds(settings: StoredSettings, source: StyleSource): string[] {
  const selected = new Set((settings.selectedSections ?? defaultSectionIds(settings.tier)).map(canonicalSectionId));
  return source.options.filter((option) => selected.has(option.id)).map((option) => option.id);
}

function effectiveSectionIds(settings: StoredSettings, source: StyleSource): string[] {
  return settings.tier === "normal" ? [] : selectedSectionIds(settings, source);
}

export function normalizeStoredSettings(settings: StoredSettings, source: StyleSource): StoredSettings {
  const knownItems = new Map(
    [...source.roots.skill, ...source.roots.dictionary].flatMap((root) => flattenNodes([root]))
      .filter((node) => node.kind === "entry")
      .map((node) => [node.id, node] as const),
  );
  const normalized: StoredSettings = {
    ...settings,
    ...(settings.selectedSections === undefined ? {} : { selectedSections: selectedSectionIds(settings, source) }),
  };
  const itemOverrides = settings.itemOverrides
    ? Object.fromEntries(Object.entries(settings.itemOverrides).filter(([id, value]) => {
        const node = knownItems.get(id);
        return node !== undefined && typeof value === "boolean" && value !== inheritedEntryEnabled(node, normalized, source);
      }))
    : undefined;
  if (itemOverrides && Object.keys(itemOverrides).length > 0) normalized.itemOverrides = itemOverrides;
  else delete normalized.itemOverrides;
  return normalized;
}

export function sameStoredSettings(left: StoredSettings, right: StoredSettings): boolean {
  if (left.tier !== right.tier) return false;
  if ((left.skillEnabled ?? true) !== (right.skillEnabled ?? true)) return false;
  if (left.selectedSections === undefined || right.selectedSections === undefined) {
    if (left.selectedSections !== right.selectedSections) return false;
    return JSON.stringify(left.itemOverrides ?? {}) === JSON.stringify(right.itemOverrides ?? {});
  }
  const sectionsEqual = left.selectedSections.length === right.selectedSections.length &&
    left.selectedSections.every((id, index) => id === right.selectedSections?.[index]);
  if (!sectionsEqual) return false;
  return JSON.stringify(left.itemOverrides ?? {}) === JSON.stringify(right.itemOverrides ?? {});
}

export function fullSettingsPatch(settings: StoredSettings): SettingsPatch {
  return {
    tier: settings.tier,
    skillEnabled: settings.skillEnabled ?? true,
    selectedSections: settings.selectedSections === undefined ? null : settings.selectedSections,
    itemOverrides: settings.itemOverrides ?? null,
  };
}

function removeWorkingMinimumOverlaps(content: string, selected: Set<string>): string {
  const removedLabels = new Set(
    Object.entries(WORKING_MINIMUM_OVERLAPS)
      .filter(([id]) => selected.has(id))
      .map(([, label]) => label),
  );
  if (removedLabels.size === 0) return content;

  const lines = content.split("\n");
  const result: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const label = WORKING_MINIMUM_LABELS.find((candidate) =>
      candidate === "Присказки" ? trimmed.startsWith("Присказки") : trimmed === candidate
    );
    if (label) skipping = removedLabels.has(label);
    if (!skipping) result.push(line);
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function selectTierVariant(content: string, tier: Tier): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skippingVariant = false;
  let pendingBlankLines: string[] = [];

  for (const line of lines) {
    const variant = line.match(/^- (lite|full|ultra):/);
    if (variant) {
      pendingBlankLines = [];
      skippingVariant = variant[1] !== tier;
      if (!skippingVariant) result.push(line);
      continue;
    }
    if (skippingVariant) {
      if (line.trim() === "") {
        pendingBlankLines.push(line);
        continue;
      }
      if (/^\s{2,}\S/.test(line)) {
        pendingBlankLines = [];
        continue;
      }
      result.push(...pendingBlankLines);
      pendingBlankLines = [];
      skippingVariant = false;
    }
    result.push(line);
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function compileSelectedOption(option: SourceOption, selected: Set<string>, tier: Tier): string {
  let content = option.content;
  if (option.id === sourceId("skill", "Словарь (рабочий минимум)")) {
    content = removeWorkingMinimumOverlaps(content, selected);
  }
  return compileRuntimeMarkdown(selectTierVariant(content, tier));
}

export function flattenNodes(nodes: ConfigNode[]): ConfigNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

export function inheritedEntryEnabled(node: ConfigNode, settings: StoredSettings, source: StyleSource): boolean {
  return node.optionId !== undefined && selectedSectionIds(settings, source).includes(node.optionId);
}

export function entryEnabled(node: ConfigNode, settings: StoredSettings, source: StyleSource): boolean {
  const override = settings.itemOverrides?.[node.id];
  if (override !== undefined) return override;
  return inheritedEntryEnabled(node, settings, source);
}

function explicitlyDisabledTerms(settings: StoredSettings, source: StyleSource): Set<string> {
  const entries = flattenNodes([
    ...source.roots.skill,
    ...source.roots.dictionary,
  ]).filter((node) => node.kind === "entry" && settings.itemOverrides?.[node.id] === false);
  return new Set(
    entries.flatMap((entry) => [entry.label, ...entry.aliases])
      .filter(Boolean)
      .map((term) => term.toLocaleLowerCase("ru")),
  );
}

function matchesExplicitlyDisabledTerm(node: ConfigNode, disabledTerms: Set<string>): boolean {
  return [node.label, ...node.aliases].some((term) => disabledTerms.has(term.toLocaleLowerCase("ru")));
}

function compileListOption(
  option: SourceOption,
  settings: StoredSettings,
  source: StyleSource,
  disabledTerms: Set<string>,
): string | undefined {
  const root = option.nodes[0];
  if (!root) return option.content;
  const enabled = (node: ConfigNode) =>
    entryEnabled(node, settings, source) && !matchesExplicitlyDisabledTerm(node, disabledTerms);
  const enabledEntries = flattenNodes([root]).filter((node) => node.kind === "entry" && enabled(node));
  if (enabledEntries.length === 0) return undefined;

  const originalLines = option.content.split("\n");
  const firstStructural = Math.min(...root.children.map((node) => node.line - option.line));
  const intro = originalLines.slice(0, firstStructural < 0 ? 1 : firstStructural).join("\n").trimEnd();
  const blocks: string[] = [intro];
  let entryRun: string[] = [];
  const flushEntryRun = () => {
    if (entryRun.length > 0) blocks.push(entryRun.join("\n"));
    entryRun = [];
  };
  for (const child of root.children) {
    if (child.kind === "group") {
      flushEntryRun();
      const entries = child.children.filter((entry) => entry.kind === "entry" && enabled(entry));
      if (entries.length > 0) blocks.push(`${child.markdown}\n\n${entries.map((entry) => entry.markdown).join("\n")}`);
    } else if (child.kind === "entry" && enabled(child)) {
      entryRun.push(child.markdown);
    }
  }
  flushEntryRun();
  return compileRuntimeMarkdown(blocks.filter(Boolean).join("\n\n"));
}

export function buildStylePolicy(settings: StoredSettings, source: StyleSource): string | undefined {
  const tier = settings.tier;
  if (tier === "normal" || settings.skillEnabled === false) return undefined;
  const selected = new Set(effectiveSectionIds(settings, source));
  const disabledTerms = explicitlyDisabledTerms(settings, source);
  const policy = [
    ...source.common,
    ...source.options.map((option) => {
      if (option.section === "dictionary") return compileListOption(option, settings, source, disabledTerms);
      const hasEntries = flattenNodes(option.nodes).some((node) => node.kind === "entry");
      if (option.section === "skill" && hasEntries) {
        const compiled = compileListOption(option, settings, source, disabledTerms);
        return compiled ? removeWorkingMinimumOverlaps(compiled, selected) : undefined;
      }
      return selected.has(option.id) ? compileSelectedOption(option, selected, tier) : undefined;
    }),
    source.tiers[tier],
  ].filter(Boolean).join("\n\n");
  return policy;
}

const STYLE_PROMPT_LEAD =
  "Стиль ответов: Pohuy. Применяй его только к обычному тексту ответа. Не меняй вызовы и результаты инструментов, структурированные данные и инструкции с более высоким приоритетом.";

export function buildStylePrompt(settings: StoredSettings, source: StyleSource): string | undefined {
  const policy = buildStylePolicy(settings, source);
  if (!policy || settings.tier === "normal") return undefined;
  return [STYLE_PROMPT_LEAD, policy].join("\n\n");
}

function managedStyleBlock(stylePrompt: string | undefined): string | undefined {
  return stylePrompt ? `${PROMPT_START}\n${stylePrompt}\n${PROMPT_END}` : undefined;
}

type StylePromptReport = {
  stylePrompt?: string;
  managedBlock?: string;
  policyCharacters: number;
  managedCharacters: number;
  selectedSections: number;
  totalSections: number;
  dictionaryEnabled: number;
  dictionaryTotal: number;
  scenesEnabled: number;
  scenesTotal: number;
  explicitOverrides: number;
  explicitlyEnabled: number;
  explicitlyDisabled: number;
  huenitivEnabled: boolean;
};

export function buildStylePromptReport(settings: StoredSettings, source: StyleSource): StylePromptReport {
  const policy = buildStylePolicy(settings, source);
  const stylePrompt = buildStylePrompt(settings, source);
  const managedBlock = managedStyleBlock(stylePrompt);
  const dictionaryEntries = flattenNodes(source.roots.dictionary).filter((node) => node.kind === "entry");
  const sceneEntries = flattenNodes(source.roots.scenes).filter((node) => node.kind === "scene");
  const dictionary = {
    enabled: dictionaryEntries.filter((node) => entryEnabled(node, settings, source)).length,
    total: dictionaryEntries.length,
  };
  const scenes = {
    enabled: sceneEntries.filter((node) => node.optionId && selectedSectionIds(settings, source).includes(node.optionId)).length,
    total: sceneEntries.length,
  };
  return {
    ...(stylePrompt ? { stylePrompt } : {}),
    ...(managedBlock ? { managedBlock } : {}),
    policyCharacters: policy?.length ?? 0,
    managedCharacters: managedBlock?.length ?? 0,
    selectedSections: effectiveSectionIds(settings, source).length,
    totalSections: source.options.length,
    dictionaryEnabled: dictionary.enabled,
    dictionaryTotal: dictionary.total,
    scenesEnabled: scenes.enabled,
    scenesTotal: scenes.total,
    explicitOverrides: Object.keys(settings.itemOverrides ?? {}).length,
    explicitlyEnabled: Object.values(settings.itemOverrides ?? {}).filter(Boolean).length,
    explicitlyDisabled: Object.values(settings.itemOverrides ?? {}).filter((enabled) => !enabled).length,
    huenitivEnabled: effectiveSectionIds(settings, source).includes(HUENITIV_OPTION_ID),
  };
}

export function stripManagedStyleBlocks(prompt: string): string {
  const openStarts: number[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  while (cursor < prompt.length) {
    const start = prompt.indexOf(PROMPT_START, cursor);
    const end = prompt.indexOf(PROMPT_END, cursor);
    if (start === -1 && end === -1) break;

    if (start !== -1 && (end === -1 || start < end)) {
      openStarts.push(start);
      cursor = start + PROMPT_START.length;
      continue;
    }

    if (openStarts.length > 0) {
      ranges.push({
        start: openStarts.pop()!,
        end: end + PROMPT_END.length,
      });
    }
    cursor = end + PROMPT_END.length;
  }

  for (const start of openStarts) ranges.push({ start, end: prompt.length });
  if (ranges.length === 0) return prompt;

  const merged = ranges
    .sort((left, right) => left.start - right.start)
    .reduce<Array<{ start: number; end: number }>>((result, range) => {
      const previous = result.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        result.push({ ...range });
      }
      return result;
    }, []);
  const expanded = merged
    .map((range) => {
      let { start, end } = range;
      while (start > 0 && prompt[start - 1] === "\n") start -= 1;
      while (end < prompt.length && prompt[end] === "\n") end += 1;
      return { start, end };
    })
    .reduce<Array<{ start: number; end: number }>>((result, range) => {
      const previous = result.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        result.push({ ...range });
      }
      return result;
    }, []);

  let result = "";
  cursor = 0;
  for (const range of expanded) {
    result += prompt.slice(cursor, range.start);
    if (result.length > 0 && range.end < prompt.length) result += "\n\n";
    cursor = range.end;
  }
  result += prompt.slice(cursor);
  return result;
}

export function placeStylePromptAtAppendBoundary(
  basePrompt: string,
  appendSystemPrompt: string | undefined,
  stylePrompt: string | undefined,
): string {
  const block = managedStyleBlock(stylePrompt);
  const append = appendSystemPrompt?.trim();
  const trimmedBase = basePrompt.trimEnd();
  const appendIndex =
    append && (trimmedBase === append || trimmedBase.endsWith(`\n${append}`))
      ? trimmedBase.length - append.length
      : -1;
  if (append && appendIndex >= 0) {
    const originalBefore = basePrompt.slice(0, appendIndex);
    const cleanBefore = stripManagedStyleBlocks(originalBefore);
    if (!block && cleanBefore === originalBefore) return basePrompt;

    const before = cleanBefore.replace(/\n+$/, "");
    const after = basePrompt.slice(appendIndex).replace(/^\n+/, "");
    return [before, block, after].filter(Boolean).join("\n\n");
  }

  const cleanBase = stripManagedStyleBlocks(basePrompt);
  if (!block) return cleanBase;
  return cleanBase ? `${cleanBase}\n\n${block}` : block;
}


