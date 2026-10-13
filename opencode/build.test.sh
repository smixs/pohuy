#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
base=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
root=${base%/*}
work=$(mktemp -d "$base/.build-test.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
fixture=$work/project\ with\ spaces
mkdir -p -- "$fixture/opencode" "$fixture/skills/pohuy" "$work/cwd"
cp -- "$base/build.sh" "$base/vasilich.template.md" "$fixture/opencode/"
cp -- "$root/skills/pohuy/SKILL.md" "$fixture/skills/pohuy/"
cp -R -- "$root/skills/pohuy/references" "$fixture/skills/pohuy/"
cp -- "$root/LICENSE" "$fixture/LICENSE"
script=$fixture/opencode/build.sh
out=$fixture/opencode/dist/v1/Василич.md
out2=$fixture/opencode/dist/v2/Василич.md
legacy=$fixture/opencode/dist/Василич.md
refs=$fixture/skills/pohuy/references

run() {
  (cd -- "$work/cwd" && bash "$script" "$@")
}

reject() {
  if run "$@" > "$work/rejected.log" 2>&1; then
    printf 'Expected failure: %s\n' "$*" >&2
    exit 1
  fi
}

unchanged() {
  cmp -- "$out" "$work/baseline"
  cmp -- "$out2" "$work/baseline2"
}

run --help
reject --unknown
reject --check extra
reject ''
reject --check
[[ ! -e $fixture/opencode/dist ]]
run
run --check
cp -- "$out" "$work/baseline"
cp -- "$out2" "$work/baseline2"

front() {
  awk 'NR == 1 { next } /^---$/ { exit } { print }' "$1"
}
body() {
  awk 'n >= 2 { print; next } /^---$/ { n++ }' "$1"
}
front "$out" > "$work/front1"
front "$fixture/opencode/vasilich.template.md" > "$work/template-front"
cmp -- "$work/front1" "$work/template-front"
front "$out2" > "$work/front2"
if grep -Eq '^(name|permission|model):|action: .list.' "$work/front2"; then exit 1; fi
if grep -Eq '^model:' "$work/front1"; then exit 1; fi
awk '
  /^description: / { if (NR != 1) exit 1; next }
  /^mode: all$/ { if (NR != 2) exit 1; next }
  /^permissions:$/ { if (NR != 3) exit 1; next }
  { if (NR < 4) exit 1; print }
' "$work/front2" > "$work/rules"
awk '
  /^  / {
    if ($0 == "  read:") { read=1; next }
    if (read && /^    /) { action="read"; resource=$1; effect=$2 }
    else { read=0; action=$1; resource="\047*\047"; effect=$2 }
    sub(/:$/, "", action); sub(/:$/, "", resource)
    gsub(/\047/, "", action)
    if (action == "list") next
    printf "  - action: \047%s\047\n    resource: %s\n    effect: %s\n", action, resource, effect
  }
' "$work/front1" > "$work/expected-rules"
cmp -- "$work/rules" "$work/expected-rules"
body "$out" > "$work/body1"
body "$out2" > "$work/body2"
cmp -- "$work/body1" "$work/body2"
for artifact in "$out" "$out2"; do
  awk 'active { print } /^## Лицензия$/ { getline; active=1 }' "$artifact" > "$work/license"
  cmp -- "$fixture/LICENSE" "$work/license"
done

embedded() {
  local start end
  case $1 in
    skills/pohuy/SKILL.md)
      start='Отвечай как живой русский инженер, который двадцать лет чинит прод. Вся техническая'
      end='# ХУЕНИТИВЫ — ИНСТРУКЦИЯ ДЛЯ АГЕНТА' ;;
    skills/pohuy/references/huenitiv.md)
      start='# ХУЕНИТИВЫ — ИНСТРУКЦИЯ ДЛЯ АГЕНТА'
      end='# Онтология предметной области' ;;
    skills/pohuy/references/ontologia.md)
      start='# Онтология предметной области'
      end='# Сцены: шкала состояний и эталонные примеры' ;;
    skills/pohuy/references/sceny.md)
      start='# Сцены: шкала состояний и эталонные примеры'
      end='# Словарь: расширение' ;;
    skills/pohuy/references/slovar.md)
      start='# Словарь: расширение'
      end='## Конец встроенных стилевых материалов' ;;
    *) return 1 ;;
  esac
  awk -v start="$start" -v end="$end" '
    $0 == start { active=1; found++ }
    active && $0 == end { ended=1; exit }
    active { print }
    END { if (found != 1 || !ended) exit 1 }
  ' "$out"
}

embedded skills/pohuy/SKILL.md > "$work/embedded-skill"
if grep -Eq '^(---|name:|description:|## (Активация|Persistence|Boundaries))|curl|Пре-флайт|skills update|references/' "$work/embedded-skill"; then exit 1; fi
awk '
  /^---$/ { front++; next }
  front < 2 { next }
  /^## / { skip=($0 == "## Активация" || $0 == "## Persistence" || $0 == "## Boundaries") }
  !skip { print }
' "$root/skills/pohuy/SKILL.md" | sed '/./,$!d' > "$work/expected-skill"
sed \
  -e 's/во встроенном разделе «Сцены: шкала состояний и эталонные примеры»/в `references\/sceny.md`/g' \
  -e 's/во встроенном разделе «Словарь: расширение»/в `references\/slovar.md`/g' \
  -e 's/во встроенном разделе «ХУЕНИТИВЫ — ИНСТРУКЦИЯ ДЛЯ АГЕНТА»/в `references\/huenitiv.md`/g' \
  -e 's/^| \*\*full\*\* | Идиомы везде, где их сказал бы живой человек\. |$/| **full** | Идиомы везде, где их сказал бы живой человек. Default. |/' \
  -e 's/^| \*\*ultra\*\* | Максимальная плотность, присказки, рифмы\. Каждый ответ — монолог у курилки\. Default\. |$/| **ultra** | Максимальная плотность, присказки, рифмы. Каждый ответ — монолог у курилки. |/' \
  "$work/embedded-skill" > "$work/restored-skill"
[[ $(< "$work/restored-skill") == "$(< "$work/expected-skill")" ]]

for name in slovar sceny ontologia huenitiv; do
  embedded "skills/pohuy/references/$name.md" > "$work/embedded-reference"
  sed \
    -e 's/Читается один раз при активации скилла\. //g' \
    -e 's/Читается один раз при активации\. //g' \
    -e 's/Постановка — как в SKILL.md:/Постановка — как во встроенном разделе «Правила»:/g' \
    -e 's/Теория — в `ontologia.md`\./Теория — во встроенном разделе «Онтология предметной области»./g' \
    "$refs/$name.md" > "$work/expected-reference"
  [[ $(< "$work/embedded-reference") == "$(< "$work/expected-reference")" ]]
done
for phrase in '## Словарь (рабочий минимум)' 'бля буду — гарантирую' 'он отъебётся навсегда' 'доке этого вендора веры ноль' 'Еблан из git blame' 'Вендор-пиздабол' 'Это эталоны тона' 'Это боекомплект, не энциклопедия.' 'Хуйня вопрос, вернул — работает заебись.'; do
  grep -Fq -- "$phrase" "$out"
done
if grep -Ei 'preflight|Пре-флайт|Читается один раз при активации|только примерами стиля|полушутливый сабагент тупо расслабиться|уставш|Embedded reference material|По умолчанию full|\*\*full\*\*.*Default' "$out"; then exit 1; fi
for phrase in 'По умолчанию ultra:' '| **full** | Идиомы везде, где их сказал бы живой человек. |' '| **ultra** | Максимальная плотность, присказки, рифмы. Каждый ответ — монолог у курилки. Default. |' 'description: Объясняет стажёру, как работает код текущего проекта, простым русским языком.' 'Ты объясняешь стажёру, как работает код:'; do
  grep -Fq -- "$phrase" "$out"
done
[[ $(grep -c 'Default' "$out") == 1 ]]
[[ $(grep -c '^---$' "$out") == 2 ]]
for phrase in "  '*': deny" '  external_directory: deny' 'Используй словарь, сцены, присказки и онтологию ниже как основу живой речи' 'но не выдавай события из примеров за факты проекта или собственные действия.' 'Не унижай пользователя и его семью'; do
  grep -Fq -- "$phrase" "$out"
done

for heading in '## Активация' '## Persistence' '## Правила' '## Шкала состояний проекта' '## Словарь (рабочий минимум)' '## Уровни' '## Хуенитивы' '## Auto-Clarity (мат выключается)' '## Boundaries'; do
  for mutation in missing duplicate; do
    awk -v heading="$heading" -v mutation="$mutation" '
      $0 == heading { if (mutation == "missing") next; print }
      { print }
    ' "$root/skills/pohuy/SKILL.md" > "$fixture/skills/pohuy/SKILL.md"
    reject
    reject --check
    unchanged
  done
done
cp -- "$root/skills/pohuy/SKILL.md" "$fixture/skills/pohuy/SKILL.md"
for mutation in '1d' 's/`references\/slovar.md`/`missing.md`/g' 's/Default\. //' '/^| \*\*full\*\* |/p' '/^| \*\*ultra\*\* |/d'; do
  sed "$mutation" "$root/skills/pohuy/SKILL.md" > "$fixture/skills/pohuy/SKILL.md"
  reject
  unchanged
done
cp -- "$root/skills/pohuy/SKILL.md" "$fixture/skills/pohuy/SKILL.md"
for name in sceny slovar; do
  for mutation in '1d' 's/Читается один раз/Служебная фраза изменилась/' '/Читается один раз/p'; do
    sed "$mutation" "$root/skills/pohuy/references/$name.md" > "$refs/$name.md"
    reject
    unchanged
  done
  cp -- "$root/skills/pohuy/references/$name.md" "$refs/$name.md"
done
run
unchanged
printf '\nStale template fixture\n' >> "$fixture/opencode/vasilich.template.md"
reject --check
unchanged
cp -- "$base/vasilich.template.md" "$fixture/opencode/vasilich.template.md"
sed 's/## Правила/## Правила\n\nStale skill fixture/' "$root/skills/pohuy/SKILL.md" > "$fixture/skills/pohuy/SKILL.md"
reject --check
unchanged
cp -- "$root/skills/pohuy/SKILL.md" "$fixture/skills/pohuy/SKILL.md"
printf '\nStale reference fixture\n' >> "$refs/slovar.md"
reject --check
unchanged
cp -- "$root/skills/pohuy/references/slovar.md" "$refs/slovar.md"

for source in "$fixture/LICENSE" "$fixture/opencode/vasilich.template.md" "$fixture/skills/pohuy/SKILL.md" "$refs/slovar.md" "$refs/sceny.md" "$refs/ontologia.md" "$refs/huenitiv.md"; do
  mv -- "$source" "$work/source"
  reject
  unchanged
  ln -s -- "$work/source" "$source"
  reject
  reject --check
  unchanged
  rm -- "$source"
  mv -- "$work/source" "$source"
done

mkdir -p -- "$refs/nested space/deeper"
printf 'Nested Markdown fixture\n' > "$refs/nested space/deeper/a file.md"
reject --check
unchanged
run
run --check
grep -Fq 'Nested Markdown fixture' "$out"
cp -- "$out" "$work/nested"
run
cmp -- "$out" "$work/nested"
rm -rf -- "$refs/nested space"
run
unchanged

ln -s -- "$work" "$refs/linked directory"
reject
unchanged
rm -- "$refs/linked directory"
ln -s -- "$work/absent" "$refs/dangling.txt"
reject
unchanged
rm -- "$refs/dangling.txt"
mv -- "$refs" "$work/references"
ln -s -- "$work/references" "$refs"
reject
unchanged
rm -- "$refs"
mv -- "$work/references" "$refs"

for artifact in "$out" "$out2"; do
mv -- "$artifact" "$work/output"
reject --check
ln -s -- "$work/output" "$artifact"
reject
reject --check
rm -- "$artifact"
ln -s -- "$work/missing-output" "$artifact"
reject
reject --check
[[ ! -e $work/missing-output ]]
rm -- "$artifact"
mv -- "$work/output" "$artifact"
unchanged
printf '\nStale output\n' >> "$artifact"
reject --check
run
unchanged
parent=${artifact%/*}
mv -- "$parent" "$work/version"
ln -s -- "$work/version" "$parent"
reject
reject --check
rm -- "$parent"
mv -- "$work/version" "$parent"
unchanged
done
mv -- "$fixture/opencode/dist" "$work/dist"
ln -s -- "$work/dist" "$fixture/opencode/dist"
reject
reject --check
cmp -- "$work/dist/v1/Василич.md" "$work/baseline"
cmp -- "$work/dist/v2/Василич.md" "$work/baseline2"
rm -- "$fixture/opencode/dist"
mv -- "$work/dist" "$fixture/opencode/dist"

awk '/^## Лицензия$/ { exit } { print }' "$out" > "$work/legacy-extra"
sed '$d' "$work/legacy-extra" > "$legacy"
reject --check
run
[[ ! -e $legacy ]]
unchanged
printf 'Unrelated file\n' > "$legacy"
reject
reject --check
unchanged
[[ $(< "$legacy") == 'Unrelated file' ]]
rm -- "$legacy"
ln -s -- "$work/absent" "$legacy"
reject
reject --check
rm -- "$legacy"
mkdir -- "$legacy"
reject
rmdir -- "$legacy"

for mutation in 's/mode: all/mode: primary/' 's/permission:/permissions:/' '/^---$/d' '/^  read:/d' '/^description:/a model: invalid'; do
  sed "$mutation" "$base/vasilich.template.md" > "$fixture/opencode/vasilich.template.md"
  reject
  reject --check
  unchanged
done
cp -- "$base/vasilich.template.md" "$fixture/opencode/vasilich.template.md"
printf '\nChanged license\n' >> "$fixture/LICENSE"
reject --check
unchanged
cp -- "$root/LICENSE" "$fixture/LICENSE"

(
  windows=$work/windows-checkout
  mkdir -p -- "$windows" "$work/git-home" "$work/git-template"
  : > "$work/git-config"
  cp -R -- "$fixture/." "$windows/"
  cp -- "$root/.gitattributes" "$windows/"
  cp -- "$base/"*.md "$windows/opencode/"
  mkdir -p -- "$windows/skills/pohuy/references/nested space/deeper" "$windows/opencode/templates"
  printf 'Nested checkout reference\n' > "$windows/skills/pohuy/references/nested space/deeper/a file.md"
  printf 'Checkout template\n' > "$windows/opencode/templates/README.md"
  printf 'Checkout dist readme\n' > "$windows/opencode/dist/README.md"
  printf 'Unscoped checkout control\n' > "$windows/control.txt"
  bash "$windows/opencode/build.sh"
  cp -- "$windows/opencode/dist/v1/Василич.md" "$work/windows-baseline1"
  cp -- "$windows/opencode/dist/v2/Василич.md" "$work/windows-baseline2"
  windows_git() {
    env -i PATH="$PATH" LC_ALL=C HOME="$work/git-home" XDG_CONFIG_HOME="$work/git-home" \
      GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$work/git-config" GIT_ATTR_NOSYSTEM=1 \
      GIT_DIR="$windows/.git" GIT_WORK_TREE="$windows" \
      git -C "$windows" -c core.autocrlf=true -c core.safecrlf=false \
      -c core.attributesFile="$work/git-config" -c init.templateDir="$work/git-template" "$@"
  }
  windows_git init --quiet
  windows_git add -- .
  windows_git ls-files -z > "$work/windows-files"
  while IFS= read -r -d '' source; do
    case $source in
      LICENSE|*.md|*.sh)
        windows_git check-attr -z text eol -- "$source" > "$work/windows-attrs"
        printf '%s\0text\0set\0%s\0eol\0lf\0' "$source" "$source" > "$work/windows-expected-attrs"
        cmp -- "$work/windows-expected-attrs" "$work/windows-attrs" ;;
    esac
    rm -- "$windows/$source"
  done < "$work/windows-files"
  windows_git checkout-index --all --force
  printf 'Unscoped checkout control\r\n' > "$work/windows-control"
  cmp -- "$work/windows-control" "$windows/control.txt"
  while IFS= read -r -d '' source; do
    case $source in
      LICENSE|*.md|*.sh)
        if grep -q $'\r' "$windows/$source"; then exit 1; fi ;;
    esac
  done < "$work/windows-files"
  bash "$windows/opencode/build.sh" --check
  bash "$windows/opencode/build.sh"
  cmp -- "$windows/opencode/dist/v1/Василич.md" "$work/windows-baseline1"
  cmp -- "$windows/opencode/dist/v2/Василич.md" "$work/windows-baseline2"
  bash "$windows/opencode/build.sh" --check
)

find "$fixture" \( -name '*.md' -o -name LICENSE \) ! -path '*/dist/*' -print0 > "$work/markdown"
while IFS= read -r -d '' source; do
  sed 's/$/\r/' "$source" > "$work/crlf"
  mv -- "$work/crlf" "$source"
done < "$work/markdown"
run --check
unchanged
run
unchanged
if grep -q $'\r' "$out" "$out2"; then exit 1; fi
find "$fixture/opencode" -maxdepth 1 -name '.build.*' -print > "$work/leftovers"
[[ ! -s $work/leftovers ]]
printf '%s\n' 'All scoped build tests passed.'
