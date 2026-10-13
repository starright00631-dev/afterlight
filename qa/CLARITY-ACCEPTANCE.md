# Reading intake and calendar clarity acceptance

13 October 2026. Local working-tree refinement; application version **3.3.0**, workspace format **v4**. No commit, push, deployment, tag or release was created. The earlier optical and workbench acceptance fixtures remain retained.

## Changes and user purpose

- **Week:** seven proportional clock bands show accepted reservations, work windows, commitments and rest. Available, planned and open minutes stay distinct. Selecting a day focuses its editable agenda without saving. Proposals do not enter the overview until accepted. Conflicts and earlier closed allocations retain explicit meanings.
- **Add a reading:** file selection prepares a text preview without changing the workspace. Only Add reading saves it. Text remains attached to paragraph anchors for notes, review questions and concrete tasks. Preview and errors scroll into view; the save control stays visible on smaller screens. Cancellation, late asynchronous results, failed saves and duplicate submissions cannot overwrite or duplicate readings.
- **Backups:** JSON save/restore controls explain the complete workspace boundary. Restoration validates records and asks before replacement. A PDF selected there receives an inline route to Add a reading.
- **Lighting CSV:** labelled Readings for Excel, with calculated lux, targets and optional meter observations. It becomes available after an arrangement is retained. It is optional for everyday reading/planning and cannot restore a workspace. Calendar `.ics`, report `.html`, study `.json` and workspace `.json` have separately stated purposes.

## Automated verification

Environment: Windows, Node **24.15.0**, Python **3.14.4**, locked PDF.js **6.4.299**.

| Check | Observed result |
| --- | --- |
| `npm test` | **246 passed**, zero failures or skips |
| `npm run check` | Application/service syntax passed |
| `npm run build:pages` | **243 public files**; browser capabilities remain provider-disabled |
| `node scripts/verify-studio-export.mjs` | Existing optical workspace/study fields match; retained HTML/CSV match byte for byte |
| `node scripts/verify-workbench-export.mjs` | Existing workspace round trip and accepted calendar identities/UTC times match |
| Python packaging tests | **6 passed** |
| Packager dry run | Selected runtime/docs/evidence included; no archive written |
| `git diff --check` | Passed; only normal CRLF normalization notices |

Final static build ID:
`3c4af471555adf22f3bea215ae42c864b6dc5fc5f5748968d8c25a85a1eef17d`

Focused regressions include PDF parsing with bundled native CMaps, malformed/offline reader responses, real file preview and explicit save, cancellation, denied commits, 2,000 passages, dated navigation, interval unions/rest arithmetic, proposal separation and CSP-compatible SVG positioning. The security policy was not weakened.

## Actual browser acceptance

All test content was synthetic or the explicitly labelled built-in example. The local QA workspace used its own origin (`127.0.0.1:5230`); the user's existing `5183` records were not replaced. The owned `5183` server was refreshed and its retained arrangements opened successfully.

1. A genuine synthetic two-page digital PDF previewed both pages. Add reading saved its text; keeping its first passage, explanation, question and answer criteria survived reload.
2. A genuine Chinese digital PDF previewed and saved **知识测试** exactly. The native parser originally lacked the bundled CMap paths required for this fixture; supplying those resources fixed the actual defect.
3. A PDF without selectable text produced the explicit OCR/transcript explanation, kept Add disabled and created no empty source. The user's particular random PDF was not available and is not claimed to have been verified.
4. Workspace backup downloaded, validated and restored through the actual confirmation flow. A PDF chosen in Restore produced an inline explanation and left the workspace intact. The separate Add a reading route opened the intended intake.
5. The example calendar, one 30-minute commitment and one closed day produced **510 available**, **165 planned**, **325 open after rest** and **20 rest-buffer** minutes. Before acceptance the chart had zero planned minutes; a proposal stayed visibly separate. Selecting a chart day focused the matching dated agenda.
6. A real retained lighting arrangement enabled CSV. Its two rows matched the saved study exactly: point A **240 lx**, point B **35.730265618191915 lx**. These are calculated values, not physical measurements.
7. The final static build on a fresh local origin (`5232`) extracted/saved the Chinese PDF and restored the same workspace. Its SVG bands had the intended proportional rendered widths under the actual CSP; no error logs were captured at that successful stage. An initial Python test host served `.mjs` as `text/plain`; the QA host was corrected to `text/javascript`, with `.wasm` as `application/wasm`, and tested at a fresh origin to avoid the cached failed response. The temporary static servers were then stopped.
8. Day/night desktop (**1366 × 900**), phone (**390 × 844**) and compact laptop (**668 × 518**) views were inspected. The phone calendar fits seven day rows and its key together; no horizontal document overflow was observed. PDF preview and the complete Add button remain reachable at phone/compact sizes. Temporary viewport settings were reset.

## Retained evidence

- [Day timeline](clarity-calendar-day.jpg), [night timeline](clarity-calendar-night.jpg), [phone timeline](clarity-calendar-phone.jpg)
- [Compact PDF preview](clarity-pdf-compact.jpg), [phone intake](clarity-pdf-phone.jpg), [lighting download purposes](clarity-exports.jpg)
- [Browser-produced workspace](clarity-workspace.json), [matching CSV](clarity-readings.csv)

The workspace contains three readings, three ideas, four unfinished example actions and five accepted reservations. There are **zero review assessments and zero actual work-session records**; accepting a plan and importing a reading fabricated neither.

## Remaining boundaries

PDF intake extracts text rather than retaining the binary or displaying page images. It supports 20 MiB, 80 pages, 120,000 characters and 2,000 passages per reading. Scans need an external transcript/OCR step; locked files need an unlocked copy. Equations, columns and tables may need checking against the PDF. A static host must serve JavaScript modules with a JavaScript MIME type.

The calendar is a seven-day Asia/Shanghai heuristic, with no account sync, notifications or measured-productivity claims. Open minutes can include gaps smaller than the chosen useful session minimum. Fixed self-assessed revisit rules remain unchanged.

Published baseline HEAD remains `7474d2aa181d12633f3c0ad7047806d5d91a21df`. The existing release archive remains untouched, SHA-256 `3d8040d524c9d4a0f9c3273b81fb20e811a46d9e4593096165103d2bf68badef`.
