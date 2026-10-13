#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

fail() {
  printf 'build: %s\n' "$*" >&2
  exit 1
}

case "${1-}" in
  '') [[ $# -eq 0 ]] || fail 'unexpected empty argument' ;;
  --check|--help) [[ $# -eq 1 ]] || fail 'expected at most one argument' ;;
  *) fail 'usage: bash build.sh [--check|--help]' ;;
esac
if [[ ${1-} == --help ]]; then
  printf '%s\n' 'Usage: bash build.sh [--check|--help]' 'Build dist/v1/Василич.md and dist/v2/Василич.md from shared sources.' '--check compares both artifacts without rewriting them.'
  exit 0
fi

no_links() {
  local path=$1 current= part
  [[ $path == /* ]] || fail "expected absolute path: $path"
  while [[ -n $path ]]; do
    path=${path#/}
    part=${path%%/*}
    [[ -n $part ]] || break
    current=$current/$part
    [[ ! -L $current ]] || fail "symlink rejected: $current"
    if [[ $path == */* ]]; then path=${path#*/}; else break; fi
  done
}

script=${BASH_SOURCE[0]}
[[ $script == /* ]] || script=$PWD/$script
no_links "$script"
base=$(CDPATH= cd -- "$(dirname -- "$script")" && pwd -P)
root=${base%/*}
template=$base/vasilich.template.md
skill=$root/skills/pohuy/SKILL.md
refs=$root/skills/pohuy/references
license=$root/LICENSE
legacy=$base/dist/Василич.md
outputs=("$base/dist/v1/Василич.md" "$base/dist/v2/Василич.md")

regular() {
  no_links "$1"
  [[ -f $1 && -r $1 ]] || fail "missing or unreadable source: $1"
}

validate_output() {
  local out dir
  for out in "${outputs[@]}" "$legacy"; do
    no_links "$out"
    [[ ! -e $out || -f $out ]] || fail "output is not a regular file: $out"
  done
  for dir in "$base/dist" "$base/dist/v1" "$base/dist/v2"; do
    [[ ! -e $dir || -d $dir ]] || fail "not a directory: $dir"
  done
}

regular "$template"
regular "$skill"
regular "$license"
no_links "$refs"
[[ -d $refs ]] || fail "missing references directory: $refs"
for name in slovar sceny ontologia huenitiv; do
  regular "$refs/$name.md"
done
validate_output

tmp=$(mktemp -d "$base/.build.XXXXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
find "$refs" -type l -print0 > "$tmp/links"
[[ ! -s $tmp/links ]] || fail 'symlink in references rejected'
find "$refs" -name '*.md' -print0 | sort -z > "$tmp/inputs"
while IFS= read -r -d '' file; do
  regular "$file"
done < "$tmp/inputs"

normalize() {
  sed 's/\r$//' "$1"
}

replace_once() {
  local old=$1 new=$2 rest
  [[ $content == *"$old"* ]] || fail "expected text missing in $source: $old"
  rest=${content#*"$old"}
  [[ $rest != *"$old"* ]] || fail "duplicate expected text in $source: $old"
  content=${content/"$old"/"$new"}
}

adapt_skill() {
  local line section= index=0 frontmatter=0 first=1
  local -a headings=(
    '## Активация' '## Persistence' '## Правила'
    '## Шкала состояний проекта' '## Словарь (рабочий минимум)'
    '## Уровни' '## Хуенитивы' '## Auto-Clarity (мат выключается)' '## Boundaries'
  )
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    if (( first )); then
      [[ $line == --- ]] || fail 'expected skill frontmatter'
      first=0
      frontmatter=1
      continue
    fi
    if (( frontmatter == 1 )); then
      if [[ $line == --- ]]; then frontmatter=2; fi
      continue
    fi
    [[ $line != --- ]] || fail 'unexpected skill frontmatter delimiter'
    if [[ $line == '## '* ]]; then
      [[ $index -lt ${#headings[@]} && $line == "${headings[index]}" ]] || fail "unexpected skill section: $line"
      section=$line
      index=$((index + 1))
    fi
    case $section in
      '## Активация'|'## Persistence'|'## Boundaries') continue ;;
    esac
    printf '%s\n' "$line"
  done < "$skill"
  [[ $frontmatter == 2 && $index == ${#headings[@]} ]] || fail 'missing expected skill sections'
}

embed() {
  local source=$1 content
  printf '\n\n'
  case $source in
    "$skill")
      adapt_skill > "$tmp/skill"
      content=$(normalize "$tmp/skill")
      replace_once '| **full** | Идиомы везде, где их сказал бы живой человек. Default. |' '| **full** | Идиомы везде, где их сказал бы живой человек. |'
      replace_once '| **ultra** | Максимальная плотность, присказки, рифмы. Каждый ответ — монолог у курилки. |' '| **ultra** | Максимальная плотность, присказки, рифмы. Каждый ответ — монолог у курилки. Default. |'
      replace_once 'Полные примеры по каждой — в `references/sceny.md`.' 'Полные примеры по каждой — во встроенном разделе «Сцены: шкала состояний и эталонные примеры».'
      replace_once 'Полная версия с маппингами — в `references/slovar.md`.' 'Полная версия с маппингами — во встроенном разделе «Словарь: расширение».'
      replace_once 'Полный арсенал образности — в `references/slovar.md`.' 'Полный арсенал образности — во встроенном разделе «Словарь: расширение».'
      replace_once 'полная инструкция — в `references/huenitiv.md`.' 'полная инструкция — во встроенном разделе «ХУЕНИТИВЫ — ИНСТРУКЦИЯ ДЛЯ АГЕНТА».'
      ;;
    "$refs/sceny.md")
      content=$(normalize "$source")
      [[ $content == '# Сцены: шкала состояний и эталонные примеры'$'\n'* ]] || fail 'unexpected scenes heading'
      replace_once 'Читается один раз при активации. ' ''
      ;;
    "$refs/slovar.md")
      content=$(normalize "$source")
      [[ $content == '# Словарь: расширение'$'\n'* ]] || fail 'unexpected dictionary heading'
      replace_once 'Читается один раз при активации скилла. ' ''
      replace_once 'Постановка — как в SKILL.md:' 'Постановка — как во встроенном разделе «Правила»:'
      replace_once 'Теория — в `ontologia.md`.' 'Теория — во встроенном разделе «Онтология предметной области».'
      ;;
    *) content=$(normalize "$source") ;;
  esac
  printf '%s\n\n' "$content"
}

split_template() {
  local line state=0 pattern count=0
  : > "$tmp/front-v1"
  : > "$tmp/front-v2"
  : > "$tmp/body"
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    if (( state == 0 )); then
      [[ $line == --- ]] || fail 'expected template frontmatter'
      printf '%s\n' "$line" >> "$tmp/front-v1"
      printf '%s\n' "$line" >> "$tmp/front-v2"
      state=1
      continue
    fi
    if (( state == 9 )); then
      printf '%s\n' "$line" >> "$tmp/body"
      continue
    fi
    printf '%s\n' "$line" >> "$tmp/front-v1"
    case $state:$line in
      '1:name: Василич') state=2 ;;
      '2:description: '?*) printf '%s\n' "$line" >> "$tmp/front-v2"; state=3 ;;
      '3:mode: all') printf '%s\n' "$line" >> "$tmp/front-v2"; state=4 ;;
      '4:permission:') printf '%s\n' 'permissions:' >> "$tmp/front-v2"; state=5 ;;
      "5:  '*': deny") rule '*' '*' deny; state=6 ;;
      '6:  read:') state=7 ;;
      "7:    '*': allow") rule read '*' allow; state=8 ;;
      "8:    '"*"': deny")
        pattern=${line#"    '"}; pattern=${pattern%"': deny"}
        [[ -n $pattern && $pattern != *"'"* && $pattern != '*' ]] || fail 'invalid secret pattern'
        rule read "$pattern" deny
        count=$((count + 1)) ;;
      '8:  glob: allow') (( count > 0 )) || fail 'missing secret denies'; rule glob '*' allow; state=10 ;;
      '10:  grep: allow') rule grep '*' allow; state=11 ;;
      '11:  list: allow') state=12 ;;
      '12:  external_directory: deny') rule external_directory '*' deny; state=13 ;;
      '13:---') printf '%s\n' '---' >> "$tmp/front-v2"; state=9 ;;
      *) fail "unsupported template frontmatter: $line" ;;
    esac
  done < "$template"
  [[ $state == 9 && -s $tmp/body ]] || fail 'incomplete template'
}

rule() {
  printf "  - action: '%s'\n    resource: '%s'\n    effect: %s\n" "$1" "$2" "$3" >> "$tmp/front-v2"
}

split_template
{
  cat -- "$tmp/body"
  embed "$skill"
  while IFS= read -r -d '' file; do
    embed "$file"
  done < "$tmp/inputs"
  printf '\n%s\n' '## Конец встроенных стилевых материалов' 'Правила стиля выше действуют как инструкции к речи: активно используй словарь и сцены, естественно и без обязательной квоты. Вымышленные примеры не являются фактами проекта или выполненными действиями и не дают полномочий на изменения. Границы роли сохраняются: только чтение и объяснение текущего проекта, без сети, запуска команд, изменений и делегирования.'
} > "$tmp/common"
cat -- "$tmp/front-v1" "$tmp/common" > "$tmp/legacy"
if [[ -f $legacy ]]; then
  normalize "$legacy" | sed 's/безопасные исходники через glob\/list\./безопасные исходники через glob./' > "$tmp/old"
  cmp -s -- "$tmp/legacy" "$tmp/old" || fail 'legacy output is not the corresponding artifact; refusing removal'
fi
printf '\n## Лицензия\n\n' >> "$tmp/common"
normalize "$license" >> "$tmp/common"
for version in v1 v2; do
  cat -- "$tmp/front-$version" "$tmp/common" > "$tmp/$version"
done

validate_output
if [[ ${1-} == --check ]]; then
  for index in 0 1; do
    out=${outputs[index]}
    [[ -f $out ]] || fail "artifact missing: $out; run bash build.sh"
    cmp -s -- "$tmp/v$((index + 1))" "$out" || fail "artifact stale: $out; run bash build.sh"
  done
  [[ ! -e $legacy ]] || fail 'legacy artifact remains; run bash build.sh'
  printf '%s\n' 'Both artifacts are up to date.'
else
  mkdir -p -- "$base/dist/v1" "$base/dist/v2"
  validate_output
  for index in 0 1; do
    mv -f -- "$tmp/v$((index + 1))" "${outputs[index]}"
  done
  if [[ -f $legacy ]]; then rm -- "$legacy"; fi
  printf '%s\n' 'Built dist/v1/Василич.md and dist/v2/Василич.md'
fi
