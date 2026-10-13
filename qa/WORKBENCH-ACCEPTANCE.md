# Local study-planner acceptance

Verified 13 October 2026 in `D:\work\afterlight`, on Windows with Node.js **24.15.0** and Python **3.14.4**. Package version remains **3.3.0**. This is a local working-tree refinement, with no commit, push, deployment, tag or release update. The existing optical QA report and published screenshots are retained separately.

## Result and scope

Week now uses explicitly adopted shared availability across projects, commitments, date exceptions, useful minimum blocks, a separate inbox, reviewable proposals, accepted stable allocations, pins, manual placement and guarded unschedule Undo. Desk offers actual ready work and bounded source review. Quiet retains explicit work outcomes, elapsed duration, output, remaining effort and next step. Older source, draft, practice and optical records migrate without invented history.

The [rationale](../docs/study-planner-rationale.md) records the inspected reference projects, transferred ideas, original implementation and bounded REA evidence. Fixed 1/3/7-day self-assessed review dates remain; adaptive FSRS, calendar synchronization, reminders and automated grading are outside this pass.

## Automated evidence

| Check | Result |
| --- | --- |
| `npm run check` | Application/service module syntax passed. |
| `npm test` | **219 passed, 0 failed, 0 skipped.** Includes migration, shared interval/capacity/dependency invariants, stable identities, review snapshots, source-hidden UI, saving refusal, stale Undo, actual app transitions and cross-project timer/navigation regressions. |
| `python scripts/package.py --dry-run` | **123 selected payload files** resolve; no archive was written. |
| `python -m unittest discover -s tests -p package_test.py` | **6 passed.** Selected workbench evidence travels with its verifier; private/unselected QA is excluded. Missing required evidence refuses initial creation and replacement before changing an archive. Test archives were temporary fixtures. |
| `node scripts/verify-workbench-export.mjs` | The genuine UI workspace export validates and round-trips identically. Calendar event IDs and independently computed UTC start/end times match its **6 accepted planned blocks**. |
| `node scripts/verify-studio-export.mjs` | Existing workspace/study fields match; report and CSV remain byte-for-byte matched. Synthetic observations retain their existing labels. |
| `npm run build:pages` | **240 public files**, PDF.js 6.4.299. Build ID `03baf86e13d1e961787af7f3c2b50c5df3a0e2855dc5d074075f8d2b9310fd38`. |

The build's capability module declares `mode: browser`, `assistants: false`, `pdf: browser`, `storage: browser-local`. Its authored module graph includes every new planner, workbench and review runtime module. Server services and credentials remain outside the static graph.

## Actual browser acceptance

Workflow tests used isolated origins `http://127.0.0.1:5225/` (local app) and `http://127.0.0.1:5226/` (built static edition). Sources were the built-in example and explicitly authored QA text. Recorded outcomes and assessments are test reports, not claims about a user's work or learning. No provider inference or source transmission was performed.

- Adopted the research brief's 19:00–20:30 window. Added a 19:00–19:30 seminar commitment; proposals started work after that interval. Accepted sessions remained after reload.
- Refused manual placement at 19:15 because it overlapped the commitment. Saved the valid reservation with a pin; unscheduled it and immediately restored it with Undo. Dependency-locked work controls stayed disabled. A further regression and localhost walkthrough confirmed that other ready work remains reachable beside today's reservations.
- Started the accepted action, wrote an output, closed it as needing another session, and explicitly revised remaining effort to 15 minutes. Reload preserved the output, next step and dated record; its original estimate remained 30 minutes and its action stayed unfinished.
- Added answer criteria, started a two-question review, typed an answer and reloaded. The original passage, criteria and earlier reference answers stayed hidden; the typed answer and queue position returned. Revelation showed the real passage and criteria. Assessment advanced to the next question; Undo removed that assessment and restored its actual answer.
- Finished with one checked and one skipped question. The skipped question remained due. Reserved its review time in Week without adding an assessment, then opened its retained queue. The review timer paused correctly. Source navigation retained the draft; returning to Practice hid the reference again. The explicit recall-failure path retained the partial answer and disabled non-Again ratings.
- Closing the planned question queue led to Quiet's explicit outcome form. Reporting the action finished retained its result and next step after reload; reviewing itself did not automatically mark it complete.
- Added a 15-minute measurement action to the other project. Both projects used one calendar with separate, non-overlapping reservations. Closed 16 October through a date exception; the day showed zero availability.
- The static edition loaded Studio with live calculated readings, adopted/proposed/accepted a shared calendar, restored it after reload and ran a source-hidden review. Provider controls were absent and the interface stated that local assistance was unavailable. No error-level browser console messages appeared during the inspected static workflow.

The retained [workspace export](workbench-export.json) captures the core stage: **2 projects, 6 actions, 2 assessments, 2 actual session records and 6 planned blocks**, with no active timers or review. The matching [calendar](workbench-calendar.ics) exports only those planned allocations. Later phone checks added an unassessed source question, and the date-exception check followed the export; they do not appear in that earlier fixture.

## Visual and input evidence

| View | Inspected evidence |
| --- | --- |
| Desktop, 1366 × 900 | [Night agenda](workbench-week-night.jpg), [day agenda](workbench-week-day.jpg), [hidden-source recall](workbench-review-hidden.jpg). Ivory content, ink text and brass time cues remain readable. |
| Phone, 390 × 844 | [Agenda](workbench-week-phone.jpg), [specific-question recall](workbench-review-phone.jpg). Agenda precedes the long inbox; shortcuts reach both. Recall places the work pane first, with answer and reveal actions readable. Document width was 375 CSS pixels, within the viewport. |
| Compact, 668 × 518 | [Planner](workbench-compact.jpg). Proposal and window controls remain on the first screen; document width was 653 CSS pixels, within the viewport. |
| Built browser edition | [Provider-disabled source review](workbench-static.jpg). Genuine application screenshot, not a generated concept. |

Inputs used labelled forms, native controls and semantic buttons. Existing keyboard focus and reduced-motion rules remain. Temporary viewport overrides were reset. The temporary static QA server was stopped after verification. The normal local launcher successfully served the refined source at `http://127.0.0.1:5183/`; UI workflow evidence came from the isolated origins above.

## Preservation and limits

The shipped archive SHA-256 remains `3d8040d524c9d4a0f9c3273b81fb20e811a46d9e4593096165103d2bf68badef`. REA's retained [artifact evidence](workbench-rea-artifact.json) inventories that existing archive; it does not execute or package this refinement. Optical model, geometry, immutable study evidence, license, version and provider privacy boundaries remain intact.

Migration correctness is supported by the v2/v3/v4 tests and retained optical fixtures. This report does not claim a manual migration walkthrough of every existing browser origin, compatibility with arbitrary time zones, globally optimal scheduling, measured productivity or learning gains. The published demo and release still contain the previous source until a later authorized publication.
