# Evaluation contract

These fixtures test the skill; they are not runtime prompt material.

## Semantic cases

[`evals.json`](./evals.json) describes facts that must survive, actions the answer
must recommend, the expected severity, and forbidden inventions or unsafe advice.
It deliberately does not require fixed idioms. A colorful answer with a factual
error should lose to a compact answer that preserves the technical contract.

The acceptance threshold is:

- facts and required actions: at least 4.5/5 each;
- tone and severity: at least 4/5 each;
- safety: at least 4.5/5;
- total: at least 23/25;
- zero material factual errors.

## Activation cases

[`triggers.json`](./triggers.json) separates explicit opt-in from incidental or
quoted profanity. A host can map these strings into its own skill-discovery test
harness.

## Deterministic contract

Run from the repository root:

```bash
./scripts/check-skill-contract.sh
```

This checks the runtime byte and line budgets, explicit activation guards, zero
mandatory reference loads, one calibration example at most, eval and safety
contracts, and JSON validity.

## A/B protocol

Use the same model and harness for both variants, randomize labels before judging,
and score the semantic rubric above. A controlled four-scenario run used Claude
Sonnet 5 for generation and `gpt-5.6-sol` as the blind judge:

| Metric | Existing runtime | Compact runtime |
| --- | ---: | ---: |
| Prompt cache creation | 14,625 tokens | 4,059 tokens |
| Generated output | 1,334 tokens | 284 tokens |
| Blind semantic score | 21.2/25 | 24.2/25 |

The 10,566-token cache delta is the paired runtime signal. The 14,625-token value
is the complete existing prompt in that harness, not a claim that the skill alone
contains 14,625 tokens.
