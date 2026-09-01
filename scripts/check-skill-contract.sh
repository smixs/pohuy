#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$repo_root/skills/pohuy/SKILL.md"
command_file="$repo_root/commands/pohuy.md"
eval_file="$repo_root/evals/evals.json"
trigger_file="$repo_root/evals/triggers.json"

fail() {
  printf 'check-skill-contract: %s\n' "$1" >&2
  exit 1
}

skill_bytes="$(wc -c < "$skill_file" | tr -d '[:space:]')"
skill_lines="$(awk 'END { print NR }' "$skill_file")"

(( skill_bytes <= 3500 )) || fail "SKILL.md is ${skill_bytes} bytes; budget is 3500"
(( skill_lines <= 80 )) || fail "SKILL.md is ${skill_lines} lines; budget is 80"

grep -Fq 'Explicit opt-in' "$skill_file" || fail "frontmatter must require explicit opt-in"
grep -Fq 'Never activate from incidental profanity' "$skill_file" || fail "incidental profanity guard is missing"
grep -Fq 'Accept only an empty argument, `lite`, `full`, `ultra`, or `normal`.' \
  "$command_file" || fail "command must validate the requested level"
grep -Fq 'Use `lite` for an empty argument.' \
  "$command_file" || fail "command must default to lite"
grep -Fq 'Treat `normal` as a disable command' \
  "$command_file" || fail "command must support the documented normal reset"
grep -Fq 'do not persist it' "$command_file" || fail "command must reject unsupported levels"
grep -Fq 'Do not preload supplemental references' "$command_file" || fail "command must forbid automatic reference loading"
grep -Fq 'State security warnings, destructive-action consequences, data-loss risks,' \
  "$skill_file" || fail "plain safety boundary is missing"

if grep -Eq 'references/|slovar\.md|sceny\.md|ontologia\.md' "$skill_file" "$command_file"; then
  fail "runtime instructions must not require or name supplemental reference files"
fi

example_count="$(grep -Eic 'calibration example' "$skill_file" || true)"
(( example_count <= 1 )) || fail "runtime instructions contain more than one calibration example"

python3 - "$eval_file" "$trigger_file" <<'PY'
import json
import sys


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def reject_constant(value):
    raise ValueError(f"non-standard JSON constant: {value}")


def load_strict(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle, parse_constant=reject_constant)
    except (OSError, ValueError) as error:
        raise SystemExit(f"invalid JSON in {path}: {error}") from error


evals = load_strict(sys.argv[1])
triggers = load_strict(sys.argv[2])

require(isinstance(evals, dict), "evals root must be an object")
require(isinstance(triggers, dict), "triggers root must be an object")
require(evals.get("skill_name") == "pohuy", "evals.skill_name must be pohuy")
require(triggers.get("skill_name") == "pohuy", "triggers.skill_name must be pohuy")

budget = evals["context_budget"]
expected_budget = {
    "skill_md_max_bytes": 3500,
    "skill_md_max_lines": 80,
    "mandatory_reference_loads": 0,
    "calibration_examples_max": 1,
}
for field, expected in expected_budget.items():
    actual = budget.get(field)
    require(
        type(actual) is int and actual == expected,
        f"context_budget.{field} must be {expected}, found {actual!r}",
    )

thresholds = evals["quality_thresholds"]
expected_thresholds = {
    "facts": 4.5,
    "required_actions": 4.5,
    "tone": 4.0,
    "severity": 4.0,
    "safety": 4.5,
    "total": 23.0,
    "material_factual_errors": 0,
}
for field, expected in expected_thresholds.items():
    actual = thresholds.get(field)
    require(
        type(actual) in (int, float) and actual == expected,
        f"quality_thresholds.{field} must be {expected}, found {actual!r}",
    )

cases = evals["evals"]
require(isinstance(cases, list), "evals.evals must be a list of eval cases")
require(len(cases) >= 5, f"evals.evals must contain at least 5 cases, found {len(cases)}")
required_case_fields = (
    "id",
    "prompt",
    "required_facts",
    "required_actions",
    "tone",
    "must_not",
)
case_ids = []
for case_index, case in enumerate(cases):
    require(isinstance(case, dict), f"eval case at index {case_index} must be an object")
    missing = [field for field in required_case_fields if field not in case]
    require(not missing, f"eval case {case.get('id', '?')} is missing fields: {missing}")
    require(
        isinstance(case["id"], str) and case["id"],
        "eval case id must be a non-empty string",
    )
    require(
        isinstance(case["prompt"], str) and case["prompt"],
        f"{case['id']}: prompt must be non-empty",
    )
    require(
        isinstance(case["tone"], str) and case["tone"],
        f"{case['id']}: tone must be non-empty",
    )
    for field in ("required_facts", "required_actions", "must_not"):
        value = case[field]
        require(
            isinstance(value, list) and value,
            f"{case['id']}: {field} must be a non-empty list",
        )
        require(
            all(isinstance(item, str) and item for item in value),
            f"{case['id']}: {field} entries must be non-empty strings",
        )
    case_ids.append(case["id"])
require(len(case_ids) == len(set(case_ids)), "eval case ids must be unique")

for trigger_group in ("should_activate", "should_not_activate"):
    values = triggers.get(trigger_group)
    require(
        isinstance(values, list) and values,
        f"{trigger_group} must be a non-empty list",
    )
    require(
        all(isinstance(value, str) and value for value in values),
        f"{trigger_group} entries must be non-empty strings",
    )

policy = triggers.get("policy")
require(
    isinstance(policy, str) and "Explicit opt-in only" in policy,
    "triggers.policy must require explicit opt-in",
)
trigger_overlap = set(triggers["should_activate"]) & set(triggers["should_not_activate"])
require(not trigger_overlap, f"activation trigger groups overlap: {sorted(trigger_overlap)}")
required_activation_examples = {"/pohuy", "Включи похуй-режим"}
required_non_activation_examples = {
    "Заебал уже этот flaky test. Что делать?",
    "В логе написано: `what the fuck happened`.",
}
require(
    required_activation_examples <= set(triggers["should_activate"]),
    "should_activate must include representative explicit opt-in",
)
require(
    required_non_activation_examples <= set(triggers["should_not_activate"]),
    "should_not_activate must include incidental and quoted profanity",
)

serialized = json.dumps(evals, ensure_ascii=False).lower()
for forbidden in ("new dictionary", "new idiom", "словаря v2", "идиома из"):
    require(
        forbidden not in serialized,
        f"phrasebook-coupled expectation remains: {forbidden}",
    )
PY

printf 'check-skill-contract: ok (%s bytes, %s lines, zero mandatory references)\n' \
  "$skill_bytes" "$skill_lines"
