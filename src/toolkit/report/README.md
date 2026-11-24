# Hackaudit report template

Template: `hackaudit/ops-ledger@2`  
Data schema: `hackaudit/report@1`  
Runtime: Node.js 18 or later. No build step or installed dependencies.

## Instructions for any reporting agent

Use the trusted installed Hackaudit renderer. Do not recreate the HTML, CSS, JavaScript, layout, data fields or token calculations. Report templates, scoring instructions and schemas belong to the organizer-installed package; Hackbase does not copy them into participant submissions.

Generate a fresh report from the submission's evidence:

```sh
npx hackaudit audit --html --out audit-reports
```

Inspect the saved report even when the command exits 1: that exit can indicate evidence violations. The report preserves those findings.

To reproduce HTML from an existing report JSON without re-reading or modifying the submission:

```sh
npx hackaudit render path/to/report.json --out audit-reports
```

The renderer validates `schema.json`, the template version and the canonical JSON body hash before writing output. The v2 assessment contract requires seven fixed criteria and judge evidence for a final assessment; the renderer never assigns scores or evaluates code. It preserves the report's project name, identifiers and timestamps, so the same JSON and template version produce the same HTML regardless of the agent or working directory.

Use the installed version that supports the report's `ui_template`. An unsupported version must be reported explicitly; do not silently translate it or redesign its UI. Existing evidence or signed reports must not be rewritten to satisfy a new contract. Regenerate from the original evidence when appropriate.

## Fixed presentation

Preserve these sections and their order:

1. Overview: identity, audit status, evidence metrics and judge review cues.
2. Rubric assessment: seven agent-reviewed criteria, evidence, weighted code subtotal out of 80, judge-owned demo points out of 20, Q&A and sign-off.
3. Prompt history: exact decoded text, declared model, team, timestamp, ID and verification state.
4. File evidence: paths, edit counts, declared models, timestamps, source headers and reconciliation differences.
5. Edit timeline: physical log order, per-file sequence, declared model and chain state.
6. Token consumption: independently calculated totals, session/model breakdown, observations, source references and capture gaps.
7. Integrity and findings: violations, broken-chain locations and advisory findings.
8. Report provenance: artifact inventory, identifiers, versions, digest and limits of the evidence.

The shared UI follows the hackathon's Ops Ledger design: Inter and JetBrains Mono, light/dark themes, a centered document frame, blue accents, ruled tables, square controls and numbered navigation. Preserve search, JSON export, printing, keyboard access and mobile layouts. CDN fonts are optional at runtime; system-font fallbacks keep the report usable offline.

The canonical assets are `src/report-html.js`, `src/report.css` and `src/report-client.js` in the installed package. Never maintain separate per-agent copies of their implementations.

## Data rules

`schema.json` is the machine-readable field contract. All required sections must exist; unknown top-level fields are rejected. `example.json` is a sealed empty-evidence example, not a real submission or a source of default evidence.

| Field | Required interpretation |
| --- | --- |
| `ui_template` | Exactly `hackaudit/ops-ledger@2`. |
| `project_name` | Stable filename-safe project identifier, independent of the render directory. |
| `team`, `artifacts` | Recorded identity and artifact availability. `toolkit_present` is legacy informational metadata; participant submissions no longer require embedded organizer tooling. |
| `chain`, `decode` | Edit-log verification, physical line indexes and malformed records. |
| `prompt_log.entries` | Exact decoded prompt text. Preserve unverified content labels after a break. |
| `file_evidence`, `reconcile` | Source declarations and actual reconciliation results; a path match is not file-content authentication. |
| `token_usage`, `usage_records` | Calculated observations and their source records, separate from prompts and edits. Never estimate missing values. |
| `fingerprint` | Advisory findings, unchanged and explicitly advisory. |
| `verdict` | Integrity-check result, separate from the rubric score. |
| `assessment` | Null before review, otherwise the organizer agent’s evidence-backed assessment under `../auditor/scoring.md` and the fixed `../auditor/rubric.json`. The agent chooses scores and calculates points; the renderer only displays supplied values. |
| `chain_link` | SHA-256 over compact UTF-8 JSON with recursively sorted object keys and `chain_link` omitted. Array order is preserved. |

Use `null` for unknown values and empty arrays for absent collections. Zero means a known zero. Missing logs use `ABSENT`; broken logs use `BROKEN`. A `VERIFIED` chain establishes internal consistency, not source authenticity or complete capture. Native indexes are zero-based; the UI displays physical line numbers starting at 1.

Keep model declarations and token counts labeled as agent-reported. Cumulative usage uses the latest session/model snapshot; unique turn counts are summed once. Unknown cache counts keep the total unknown. Later responses may occur after the last observation.

For scored reports, have an organizer-authorized agent follow `../auditor/SKILL.md` and `../auditor/scoring.md`. It reviews requirements and code, assigns and checks evidence-backed scores, then creates and seals a separate assessed JSON copy. Keep all forensic evidence intact. A normal `audit` run leaves `assessment: null`; it does not launch an evaluator or self-score.

Do not invent prompt-to-edit links, assessment evidence, scores, demo outcomes or independent verification. Code criteria total 80 points; live demo/Q&A contributes 20 judge-owned points. Preserve unscored criteria as null and partial code denominators; never normalize partial results. `final_total` stays null until all scores, organizer demo evidence, review resolution and sign-off exist. Scoring arithmetic and gate application belong to the reviewing agent and human review; structural validation is not an independent score audit.

Treat every submission string as untrusted. Preserve escaping, the script CSP hash, JSON export safety and the renderer's output-file protections. Do not embed submission HTML or JavaScript as executable content. Do not run participant-supplied renderer scripts while judging.

## Versioning and verification

Changes to section structure, field meanings or required data need a new template version and an explicit contract update. Agents consume a template version; they do not change one while generating a report.

After rendering, verify that the HTML and JSON show the same report ID and digest. Check decoded prompts, source discrepancies and missing-data states. Do not interpret a clean integrity result as organizer sign-off or a score.
