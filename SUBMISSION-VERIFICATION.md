# Submission copy verification

Verification date: **13 October 2026**. Application version: **3.4.0**. Workspace format: **v4**. This document records actual software checks; it is neither an AI conversation log nor an evaluation of learning outcomes.

## Checks performed on this copy

Environment: Windows, Node **24.15.0**, and locked PDF.js **6.4.299**. Dependencies were installed with `npm ci --no-audit --no-fund`.

| Check | Observed result |
| --- | --- |
| Local launch | The launcher reached the matching 3.4.0 health state. Invoking the actual BAT file from outside the directory reused the same matching service. |
| `npm run check` | Application and service module syntax checks passed. |
| `npm test` | **275 passed, 0 failed, 0 skipped.** |
| Lighting export reconciliation | Retained arrangements, original study records, and calculated values matched. HTML and CSV were byte-for-byte identical to their corresponding baselines. |
| Workspace reconciliation | JSON validation and round-trip checks matched. Actual sessions, remaining estimates, sources, and accepted calendar relationships were retained. |
| Selected-day reconciliation | Viewing a proposal did not change the backup. The fixture contained 8 accepted reservations, 225 planned minutes, 250 free minutes, and 35 rest minutes, without invented actual work or assessments. |
| `npm run build:pages` | **244 public files**, with model assistance disabled and PDF processing in the browser. |
| Actual execution | Studio in this copy restored the public example. Day and night readings matched, and no warning or error console messages were recorded. The six screenshots have documented origins. |

Static application build identifier:

```text
bb5e47b4cacbb6a9afb2cfdb78d8c19a9b65492f1cebf8d745e6c49c620b213a
```

The first launch during preparation exposed an omission of `services/answer.schema.json` from the selected source files. After adding that already-public application schema, launch and the complete test run passed. Runtime code remains consistent with the published version. A development-directory exclusion name in one build test was changed to a generic description, public documentation and asset descriptions were reorganized, and private prompts were excluded from this copy.

## English refinement and deployment instructions

All submission documentation is in English. The five prompt examples remain explicitly reconstructed, and original conversations remain private. The README and deployment guide distinguish a visitor's own localhost from a public site, provide explicit port selection for Windows/PowerShell/macOS/Linux and include a standalone GitHub Pages workflow.

A fresh dependency installation, explicit-port launcher startup on `5241`, actual BAT matching-server reuse and the 244-file static build passed after the documentation update. Port 5241 is a verification choice, not a required application address. Runtime/service/assets and tests retain the earlier verified behavior; the changes concern documentation and deployment configuration.

## Checks for the corresponding public release

Release 3.4.0 corresponds to code commit `24acf055ca0ed1871f9f8a32a7c832be305e29ba`. Its original release maintenance process also included **6 packaging regression checks**. Those are checks of the original release; this submission copy does not include the maintenance packager or original development archives.

- [Four Windows/Ubuntu checks with Node 22.13/24 passed](https://github.com/starright00631-dev/afterlight/actions/runs/38356630466).
- [Public web deployment succeeded](https://github.com/starright00631-dev/afterlight/actions/runs/38356630435).
- [Release and original archive verification information](https://github.com/starright00631-dev/afterlight/releases/tag/v3.4.0).

The public page identified itself as 3.4.0 during release verification, with the same application build identifier shown above. Public test examples are not private user experiences. Observations labelled synthetic in the fixtures are not real instrument measurements.

## Privacy and capability boundaries

Original private conversations, asset-generation prompts, API keys, account details, raw analysis archives, and installed dependencies are excluded from the submission ZIP. `ai-logs/` contains reconstructed prompt examples rather than an executed history. Whether those examples can substitute for the event's conversation-record requirement has not been confirmed.

Static source inspection did not execute the app, and its relationship graphs had capacity limits; it does not replace runtime verification. These checks do not establish successful real model inference, printed PDF pagination, operation on every device, or improved learning outcomes. Lighting uses an ideal direct-light model. Review is assessed by the user. Plans require explicit acceptance, and timers do not complete work automatically. Concurrent tabs on the same origin do not merge edits; use one active tab per workspace.
