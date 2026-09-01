#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch_root="$(mktemp -d "${TMPDIR:-/tmp}/pohuy-contract-tests.XXXXXX")"
trap 'rm -rf "$scratch_root"' EXIT

fail() {
  printf 'test-skill-contract: %s\n' "$1" >&2
  exit 1
}

make_case_copy() {
  local case_name="$1"
  local case_dir="$scratch_root/$case_name"
  mkdir -p "$case_dir"
  rsync -a --exclude='.git' "$repo_root/" "$case_dir/"
  printf '%s\n' "$case_dir"
}

expect_contract_failure() {
  local case_dir="$1"
  local expected="$2"
  local mode
  local output_file

  for mode in normal optimized; do
    output_file="$case_dir/contract-output-$mode.log"
    if [[ "$mode" == optimized ]]; then
      if PYTHONOPTIMIZE=1 \
        "$case_dir/scripts/check-skill-contract.sh" >"$output_file" 2>&1; then
        fail "contract unexpectedly passed for $(basename "$case_dir") ($mode)"
      fi
    elif env -u PYTHONOPTIMIZE \
      "$case_dir/scripts/check-skill-contract.sh" >"$output_file" 2>&1; then
      fail "contract unexpectedly passed for $(basename "$case_dir") ($mode)"
    fi
    grep -Fq "$expected" "$output_file" || {
      sed -n '1,120p' "$output_file" >&2
      fail "missing expected failure for $(basename "$case_dir") ($mode): $expected"
    }
  done
  printf '  ok: %s (normal + optimized) -> %s\n' \
    "$(basename "$case_dir")" "$expected"
}

for dependency in awk python3 rsync; do
  command -v "$dependency" >/dev/null 2>&1 || fail "$dependency is required"
done

env -u PYTHONOPTIMIZE "$repo_root/scripts/check-skill-contract.sh"
PYTHONOPTIMIZE=1 "$repo_root/scripts/check-skill-contract.sh"

for reference_file in ontologia.md sceny.md slovar.md; do
  [[ -f "$repo_root/skills/pohuy/references/$reference_file" ]] || \
    fail "optional upstream reference is missing: $reference_file"
done
printf '  ok: optional upstream references are present\n'

type_case="$(make_case_copy eval-list-type)"
python3 - "$type_case/evals/evals.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["evals"] = {}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$type_case" "evals.evals must be a list of eval cases"

count_case="$(make_case_copy eval-case-count)"
python3 - "$count_case/evals/evals.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["evals"] = []
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$count_case" "evals.evals must contain at least 5 cases, found 0"

schema_case="$(make_case_copy eval-case-schema)"
python3 - "$schema_case/evals/evals.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
del payload["evals"][0]["tone"]
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$schema_case" "eval case deploy-crash is missing fields: ['tone']"

case_type_case="$(make_case_copy eval-case-type)"
python3 - "$case_type_case/evals/evals.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["evals"][0] = "not-an-object"
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$case_type_case" "eval case at index 0 must be an object"

# Proves non-standard numeric constants cannot pass as portable JSON.
non_standard_json_case="$(make_case_copy non-standard-json)"
python3 - "$non_standard_json_case/evals/evals.json" <<'PY'
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    content = handle.read()
with open(path, "w", encoding="utf-8") as handle:
    handle.write(content.replace('{', '{"note": NaN,', 1))
PY
expect_contract_failure "$non_standard_json_case" "non-standard JSON constant: NaN"

budget_metadata_case="$(make_case_copy context-budget-metadata)"
python3 - "$budget_metadata_case/evals/evals.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["context_budget"]["skill_md_max_lines"] = 81
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$budget_metadata_case" \
  "context_budget.skill_md_max_lines must be 80, found 81"

reference_metadata_case="$(make_case_copy mandatory-reference-budget)"
python3 - "$reference_metadata_case/evals/evals.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["context_budget"]["mandatory_reference_loads"] = 1
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$reference_metadata_case" \
  "context_budget.mandatory_reference_loads must be 0, found 1"

# Proves JSON booleans cannot satisfy integer context-budget fields through equality.
boolean_budget_case="$(make_case_copy boolean-context-budget)"
python3 - "$boolean_budget_case/evals/evals.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["context_budget"]["mandatory_reference_loads"] = False
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$boolean_budget_case" \
  "context_budget.mandatory_reference_loads must be 0, found False"

# Proves JSON booleans cannot satisfy numeric quality thresholds through equality.
boolean_threshold_case="$(make_case_copy boolean-quality-threshold)"
python3 - "$boolean_threshold_case/evals/evals.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["quality_thresholds"]["material_factual_errors"] = False
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$boolean_threshold_case" \
  "quality_thresholds.material_factual_errors must be 0, found False"

budget_case="$(make_case_copy context-budget)"
python3 - "$budget_case/skills/pohuy/SKILL.md" <<'PY'
import sys

with open(sys.argv[1], "a", encoding="utf-8") as handle:
    handle.write("x" * 3501)
PY
expect_contract_failure "$budget_case" "SKILL.md is"

line_budget_case="$(make_case_copy context-line-budget)"
python3 - "$line_budget_case/skills/pohuy/SKILL.md" <<'PY'
import sys

with open(sys.argv[1], "a", encoding="utf-8") as handle:
    handle.write("\n" * 81)
PY
expect_contract_failure "$line_budget_case" "lines; budget is 80"

# Proves an unterminated final line counts toward the runtime line budget.
unterminated_line_case="$(make_case_copy unterminated-context-line-budget)"
python3 - "$unterminated_line_case/skills/pohuy/SKILL.md" <<'PY'
import sys

with open(sys.argv[1], "w", encoding="utf-8") as handle:
    handle.write("x\n" * 80 + "x")
PY
expect_contract_failure "$unterminated_line_case" "lines; budget is 80"

# Proves the slash command cannot silently restore the expensive full default.
command_default_case="$(make_case_copy command-default-level)"
python3 - "$command_default_case/commands/pohuy.md" <<'PY'
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    content = handle.read()
content = content.replace(
    "Use `lite` for an empty argument.",
    "Use `full` for an empty argument.",
    1,
)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(content)
PY
expect_contract_failure "$command_default_case" "command must default to lite"

# Proves unsupported slash-command levels cannot be persisted as runtime state.
command_validation_case="$(make_case_copy command-level-validation)"
python3 - "$command_validation_case/commands/pohuy.md" <<'PY'
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    content = handle.read()
content = content.replace(
    "Accept only an empty argument, `lite`, `full`, `ultra`, or `normal`.",
    "Accept any requested level.",
    1,
)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(content)
PY
expect_contract_failure "$command_validation_case" "command must validate the requested level"

# Proves the documented /pohuy normal reset cannot silently become unsupported.
command_reset_case="$(make_case_copy command-normal-reset)"
python3 - "$command_reset_case/commands/pohuy.md" <<'PY'
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    content = handle.read()
content = content.replace(
    "Treat `normal` as a disable command",
    "Treat `normal` as an unsupported value",
    1,
)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(content)
PY
expect_contract_failure "$command_reset_case" \
  "command must support the documented normal reset"

activation_case="$(make_case_copy activation-guard)"
python3 - "$activation_case/skills/pohuy/SKILL.md" <<'PY'
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    content = handle.read()
content = content.replace(
    "Never activate from incidental profanity",
    "Activation from incidental profanity is allowed",
    1,
)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(content)
PY
expect_contract_failure "$activation_case" "incidental profanity guard is missing"

reference_case="$(make_case_copy runtime-reference-load)"
printf '\nRead references/slovar.md before responding.\n' >> \
  "$reference_case/commands/pohuy.md"
expect_contract_failure "$reference_case" \
  "runtime instructions must not require or name supplemental reference files"

trigger_overlap_case="$(make_case_copy activation-trigger-overlap)"
python3 - "$trigger_overlap_case/evals/triggers.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["should_activate"].append(payload["should_not_activate"][0])
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$trigger_overlap_case" "activation trigger groups overlap:"

# Proves activation and non-activation fixtures cannot be swapped wholesale.
trigger_semantics_case="$(make_case_copy activation-trigger-semantics)"
python3 - "$trigger_semantics_case/evals/triggers.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["should_activate"], payload["should_not_activate"] = (
    payload["should_not_activate"],
    payload["should_activate"],
)
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$trigger_semantics_case" \
  "should_activate must include representative explicit opt-in"

safety_threshold_case="$(make_case_copy safety-threshold)"
python3 - "$safety_threshold_case/evals/evals.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    payload = json.load(handle)
payload["quality_thresholds"]["safety"] = 4.0
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
expect_contract_failure "$safety_threshold_case" \
  "quality_thresholds.safety must be 4.5, found 4.0"

safety_boundary_case="$(make_case_copy safety-boundary)"
python3 - "$safety_boundary_case/skills/pohuy/SKILL.md" <<'PY'
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    content = handle.read()
content = content.replace(
    "State security warnings, destructive-action consequences, data-loss risks,",
    "Summarize critical warnings,",
    1,
)
with open(path, "w", encoding="utf-8") as handle:
    handle.write(content)
PY
expect_contract_failure "$safety_boundary_case" "plain safety boundary is missing"

printf 'test-skill-contract: ok (production checker rejected product-owned semantic, activation, eval, context, and safety mutants in normal + optimized modes)\n'
