#!/usr/bin/env bash
# Установка стиля «Pohuy» для OpenAI Codex CLI одной командой:
#   curl -fsSL https://raw.githubusercontent.com/smixs/pohuy/main/install-codex.sh | bash
#
# Удаление:
#   ... | bash -s -- --uninstall
#
# Ставит:
#   ~/.codex/AGENTS.md                — секция Pohuy между маркерами <!-- pohuy:start/end -->
#                                       (остальное содержимое файла не трогается)
#   ~/.codex/pohuy/references/        — полный словарь и эталонные сцены
#   ~/.codex/hooks.json               — UserPromptSubmit-хук: per-turn подкрепление стиля,
#                                       тот же механизм, что у стилей Claude Code
set -euo pipefail

CODEX_DIR="${CODEX_DIR:-$HOME/.codex}"
RAW="${RAW:-https://raw.githubusercontent.com/smixs/pohuy/main}"
MODE="${1:-install}"

command -v python3 >/dev/null 2>&1 || { echo "нужен python3"; exit 1; }

REMINDER='echo "{\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":\"Pohuy style is active. Remember to follow the specific guidelines of the Pohuy Style section in AGENTS.md.\"}}"'

if [ "$MODE" = "--uninstall" ]; then
  python3 - "$CODEX_DIR" <<'PY'
import json, os, re, sys
codex = sys.argv[1]
agents = os.path.join(codex, "AGENTS.md")
if os.path.exists(agents):
    text = open(agents).read()
    new = re.sub(r"\n?<!-- pohuy:start -->.*?<!-- pohuy:end -->\n?", "\n", text, flags=re.S)
    open(agents, "w").write(new)
hooks_path = os.path.join(codex, "hooks.json")
if os.path.exists(hooks_path):
    data = json.load(open(hooks_path))
    ups = data.get("hooks", {}).get("UserPromptSubmit", [])
    data.get("hooks", {})["UserPromptSubmit"] = [
        g for g in ups
        if not any("Pohuy style is active" in h.get("command", "") for h in g.get("hooks", []))
    ]
    json.dump(data, open(hooks_path, "w"), indent=2, ensure_ascii=False)
print("Pohuy удалён из Codex. Перезапусти codex.")
PY
  exit 0
fi

mkdir -p "$CODEX_DIR/pohuy/references"

TMP_SECTION=$(mktemp)
if [ -f "$(dirname "${BASH_SOURCE[0]:-/dev/null}")/codex/AGENTS-pohuy.md" ]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cp "$SELF_DIR/codex/AGENTS-pohuy.md" "$TMP_SECTION"
  for f in slovar.md sceny.md ontologia.md huenitiv.md idioms.md; do
    cp "$SELF_DIR/skills/pohuy/references/$f" "$CODEX_DIR/pohuy/references/$f"
  done
else
  curl -fsSL "$RAW/codex/AGENTS-pohuy.md" -o "$TMP_SECTION"
  for f in slovar.md sceny.md ontologia.md huenitiv.md idioms.md; do
    curl -fsSL "$RAW/skills/pohuy/references/$f" -o "$CODEX_DIR/pohuy/references/$f"
  done
fi

python3 - "$CODEX_DIR" "$TMP_SECTION" "$REMINDER" <<'PY'
import json, os, re, sys
codex, section_path, reminder_cmd = sys.argv[1], sys.argv[2], sys.argv[3]
section = open(section_path).read().strip()

# AGENTS.md: заменить секцию между маркерами или дописать в конец.
agents = os.path.join(codex, "AGENTS.md")
text = open(agents).read() if os.path.exists(agents) else ""
if "<!-- pohuy:start -->" in text:
    text = re.sub(r"<!-- pohuy:start -->.*?<!-- pohuy:end -->", section, text, flags=re.S)
else:
    text = (text.rstrip() + "\n\n" if text.strip() else "") + section + "\n"
open(agents, "w").write(text)

# hooks.json: идемпотентно добавить UserPromptSubmit-хук.
hooks_path = os.path.join(codex, "hooks.json")
data = {}
if os.path.exists(hooks_path):
    data = json.load(open(hooks_path))
ups = data.setdefault("hooks", {}).setdefault("UserPromptSubmit", [])
already = any("Pohuy style is active" in h.get("command", "")
              for g in ups for h in g.get("hooks", []))
if not already:
    ups.append({"hooks": [{"type": "command", "command": reminder_cmd, "timeout": 5}]})
json.dump(data, open(hooks_path, "w"), indent=2, ensure_ascii=False)
with open(hooks_path, "a") as f:
    f.write("\n")
print("Секция Pohuy в", agents)
print("Per-turn хук в", hooks_path)
PY

rm -f "$TMP_SECTION"
echo "Готово. Перезапусти codex — и он заговорит по-нашему."
