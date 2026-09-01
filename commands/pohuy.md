---
description: Enable explicit Russian profane chat tone
argument-hint: "[lite|full|ultra|normal]"
---

Validate `$ARGUMENTS` before enabling the installed `pohuy` skill.
Accept only an empty argument, `lite`, `full`, `ultra`, or `normal`.
Use `lite` for an empty argument. Treat `normal` as a disable command: clear the
selected level and do not enable the skill. For any other value, do not persist it;
ask the user to choose a supported level.
Do not preload supplemental references. Keep the selected level until the session
ends or the user says `нормальный режим` or `хватит материться`.
