# Afterlight 3.4.0 — release verification

13 October 2026. This release adds shared scheduling across projects, a selected-day planner, bounded source review, dated work outcomes and preview-first reading intake. The optical model and retained study formats remain unchanged. Workspace storage is v4 with validated v3/v2 migration.

## Source checks

Windows; Node **24.15.0**, Python **3.14.4**, locked PDF.js **6.4.299**. A clean `npm ci --no-audit --no-fund` succeeded after restarting the identified application servers to release Windows' native PDF dependency lock. No unrelated process was stopped.

| Check | Observed result |
| --- | --- |
| `npm run check` | Application and service syntax passed. |
| `npm test` | **275 passed**, zero failures or skips. |
| Python packaging regressions | **6 passed**. |
| Studio export reconciliation | Original records and calculated lux preserved; retained HTML/CSV match byte for byte. |
| Workbench export reconciliation | Workspace round trip identical; accepted event IDs and UTC times match. |
| Selected-day refinement reconciliation | Proposal leaves state unchanged; **8 accepted allocations**, **225 planned / 250 open / 35 rest minutes**; prior records and identities preserved. |
| Static build | **244 public files**, PDF.js 6.4.299, provider assistance disabled. |

Static build ID: `bb5e47b4cacbb6a9afb2cfdb78d8c19a9b65492f1cebf8d745e6c49c620b213a`.

## Browser and evidence

The [workbench acceptance](WORKBENCH-ACCEPTANCE.md), [reading/export clarity acceptance](CLARITY-ACCEPTANCE.md) and [Week refinement acceptance](WEEK-REFINEMENT-ACCEPTANCE.md) retain the local implementation checks, synthetic fixtures and actual responsive screenshots. Their 3.3.0 labels record the package version before the release bump; they are historical checks of the implemented changes, not new claims about the old public release.

The 3.4.0 local server mounted the retained shared calendar. A **1920 × 1080** widescreen check verified named reservations, selected-day context, unfinished prerequisite guards, capacity totals and no horizontal document overflow in day and night appearances. New README images are actual full-page captures of that labelled example workspace, **1904 × 1375** pixels. The screenshot API supplied JPEG bytes; they were decoded to PNG without resizing or invented detail. No private workspace or provider credentials appear in those images.

The [3.3.0 verification report](RELEASE-3.3.0.md), optical export fixtures and previously published archive are retained. Its archive SHA-256 remains `3d8040d524c9d4a0f9c3273b81fb20e811a46d9e4593096165103d2bf68badef`.

## Distribution checks

A candidate ZIP was extracted into a fresh directory containing spaces with no dependencies or neighboring planning store. Its actual Windows BAT installed the locked dependencies, started a matching 3.4.0 loopback server and reused the same identified PID on a second invocation. Explicit-port BAT startup also succeeded from outside the application directory. Ten served runtime/style/artwork files matched the extracted bytes by SHA-256.

The extracted application passed syntax checks, **275 tests**, all three export verifiers and the same **244-file** static build with the identical build ID above. The clean local application mounted the starter Studio; the static build on a separate fresh origin mounted Studio, restored the synthetic workspace through the confirmation flow, displayed **510 available / 225 planned / 250 open** minutes and opened the source-linked Desk. Neither tab recorded warning/error console messages. The static runtime explicitly keeps assistance disabled and PDF processing in-browser.

Packaging verifies archive CRC, exact membership and every payload hash. The final archive preserves the candidate's runtime/assets; only documentation, Git attributes and outer fixture line endings change after candidate testing. Calendar fixtures preserve their exported CRLF bytes in Git on Windows and Linux. The first remote verification exposed normalized calendar bytes in the index; explicit re-normalization under the new attributes corrected that fixture issue. The preserved 3.3.0 report is byte-identical to the earlier archive's report. The final manifest and receipt accompany the download. Remote GitHub CI and Pages results for the published commit are linked from the release notes after publication; this report records local candidate verification.

## Limits

The calendar is a deterministic scheduling heuristic with explicit acceptance, not automatic account synchronization or measured productivity. PDF intake keeps extracted text and supports selectable-text PDFs within documented limits; it has no OCR or original-page viewer. Source review uses user criteria and fixed 1/3/7-day revisit rules; it does not grade understanding or establish learning gains. Timer duration and user-reported work outcomes remain distinct.

The lighting room is a Canvas 2D projection with an ideal direct-light model; decorative artwork contributes no calculated light. Real provider inference, printed-PDF pagination and every possible device/provider environment are not established by this release pass. Localhost storage remains separate for each origin. A bounded storage reproduction confirms that a stale same-origin tab can overwrite a newer workspace; simultaneous edits are not merged, so use one active tab per workspace. A newly adopted calendar survived the direct reload check. No assistant request with user material was sent during release verification.
