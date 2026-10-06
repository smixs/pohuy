#!/usr/bin/env bash
# Установка output style «Pohuy» для Claude Code одной командой:
#   curl -fsSL https://raw.githubusercontent.com/smixs/pohuy/main/install.sh | bash
#
# Ставит:
#   ~/.claude/output-styles/pohuy.md          — постоянный тон (output style)
#   ~/.claude/skills/pohuy/                   — скилл с полным словарём и сценами
#   ~/.claude/hooks/style-reminder.sh         — per-turn подкрепление стиля (как у родных стилей CC)
#   ~/.claude/settings.json → "outputStyle": "Pohuy" + регистрация хука
set -euo pipefail

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
RAW="${RAW:-https://raw.githubusercontent.com/smixs/pohuy/main}"

mkdir -p "$CLAUDE_DIR/output-styles" "$CLAUDE_DIR/skills/pohuy/references" "$CLAUDE_DIR/hooks"

curl -fsSL "$RAW/output-styles/pohuy.md" -o "$CLAUDE_DIR/output-styles/pohuy.md"
curl -fsSL "$RAW/skills/pohuy/SKILL.md" -o "$CLAUDE_DIR/skills/pohuy/SKILL.md"
for f in slovar.md sceny.md ontologia.md huenitiv.md idioms.md; do
  curl -fsSL "$RAW/skills/pohuy/references/$f" -o "$CLAUDE_DIR/skills/pohuy/references/$f"
done
curl -fsSL "$RAW/hooks/style-reminder.sh" -o "$CLAUDE_DIR/hooks/style-reminder.sh"
chmod +x "$CLAUDE_DIR/hooks/style-reminder.sh"

SETTINGS="$CLAUDE_DIR/settings.json"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$SETTINGS" "$CLAUDE_DIR/hooks/style-reminder.sh" <<'PY'
import json, os, sys
path, cmd = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    with open(path) as f:
        data = json.load(f)
data["outputStyle"] = "Pohuy"
hooks = data.setdefault("hooks", {}).setdefault("UserPromptSubmit", [])
if not any(h.get("command") == cmd
           for group in hooks for h in group.get("hooks", [])):
    hooks.append({"hooks": [{"type": "command", "command": cmd}]})
with open(path, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY
  echo "outputStyle: Pohuy прописан в $SETTINGS (плюс per-turn хук, чтобы тон держался всю сессию)"
else
  echo "python3 не найден — включи стиль вручную: /config -> Output style -> Pohuy"
fi

echo "Готово. Перезапусти Claude Code."
