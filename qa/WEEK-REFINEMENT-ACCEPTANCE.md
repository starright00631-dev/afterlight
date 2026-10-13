# Existing Week refinement acceptance

13 October 2026. Local working-tree refinement, package **3.3.0**, workspace **v4**. The released optical/workbench fixtures and published archive remain intact. No commit, push, deployment, tag or release was created.

## Behavior and purpose

- The existing shared-clock ribbons now name the work. Selecting a day updates an adjacent inspector with named reservations, source context, actually unfinished prerequisites and exact open intervals. The full inbox and earlier allocations remain available as secondary disclosures.
- An interval offers bounded placement alternatives after subtracting all already planned effort, including retained reservations outside the current week. Date/start/minutes are prefilled from a validated candidate. Minimum useful sessions, whole short actions, rest, deadlines and prerequisite order retain their existing meanings.
- Accepted and Proposed use the same clock extent, including an outlying accepted reservation. Proposed counts, session labels and controls explicitly identify an unreserved preview. Selection, source inspection and comparison create no timer or reservation.
- Start session is explicit. A split reservation supplies its session duration, while the task's full remaining estimate stays separate. A stale reservation is checked before any active timer is closed.
- Moving and unscheduling retain stable identities, pin behavior and guarded Undo. Invalid placement or failed persistence retains the prior records and typed editor draft. Placement/movement brings the complete form into view on smaller screens.
- Existing forest, paper, brass, typography and five destinations remain. No new calendar library or framework was introduced. PDF, provider, optical and storage boundaries remain as before.

## Automated verification

Windows; Node **24.15.0**, Python **3.14.4**, locked PDF.js **6.4.299**.

| Check | Observed result |
| --- | --- |
| `npm test` | **275 passed**, zero failures or skips |
| `npm run check` | Application/service syntax passed |
| `npm run build:pages` | **244 public files**, browser capabilities remain provider-disabled |
| `node scripts/verify-week-refinement.mjs` | Before/preview state identical; stable allocations, pins, sources, optical evidence and eight UTC events reconciled |
| `node scripts/verify-studio-export.mjs` | Existing workspace/study fields match; retained report and CSV match byte for byte |
| `node scripts/verify-workbench-export.mjs` | Earlier workspace round trip and accepted UTC calendar identities match |
| `python -m unittest discover -s tests -p package_test.py` | **6 passed** |
| `python scripts/package.py --dry-run` | **152 selected payload files**, no archive written |
| `git diff --check` | Passed, with ordinary CRLF normalization notices |

Final static build ID: `9e3a4c77796a46ae08789da849b9fa071d5f4fe6bd1988694ab7a4fbf31926cc`.

The browser static workflow below was exercised on build `9f75e187a2a04b22f35c2aa42384c3853963edb8824e877cd93ce56f52ae7609`. The final rebuild changes only the empty-calendar toolbar to expose Add an action first; that branch has its own new regression and was exercised in the retained local workspace. The populated static workflow is unchanged.

## Real browser checks

All changed test records were synthetic, labelled `Local QA`, or the built-in example. They used the isolated `127.0.0.1:5230` workspace. The user's `5183` records were not replaced.

1. Selecting Thursday displayed its exact **19:35–20:30** free interval and named the prerequisite that prevented the existing dependent action from starting. The already fully reserved actions received no duplicate placement choice.
2. A new source-linked 30-minute test action offered a **19:35** placement. Changing it to **19:30** produced a protected-rest error, left the saved total at **165 minutes**, and retained the entered value. Restoring **19:35** and saving raised accepted work to **195 minutes** without completing an action.
3. Draft & source opened the exact retained passage in Desk. No work timer or review assessment was created.
4. Adding another 30-minute test action produced a **225-minute** proposal, split into two meaningful 15-minute sessions. Accepted still showed **195 minutes**. Exporting the workspace during the proposal produced exactly the same state as before generation. Explicit acceptance alone committed the additional sessions.
5. The final browser export contains six unfinished actions and **eight accepted allocations**, including the unchanged pinned reservation. Its geometry is **510 available**, **225 planned**, **250 open** and **35 rest-buffer** minutes. All earlier accepted IDs and geometry match. There are **zero actual work-session records, zero assessments and no active timer** in these fixtures.
6. Night/day desktop (**1366 × 900 requested viewport**), phone (**390 × 844**) and compact (**668 × 518**) were inspected. Day selection exposed useful phone controls; planned/open labels remain visible and no horizontal document overflow was observed. On the compact screen, the movement form received keyboard focus and Save ended about 20 pixels above the viewport bottom.
7. The final static edition was served at a fresh origin (`5233`) with JavaScript/wasm MIME types. It restored the fixture, selected the same day, moved a reservation from **19:00** to **19:05** with the same block ID, then restored **19:00**. The chart reflected the changed rest geometry and returned to the fixture's totals. Desk showed **Local app required** and no provider controls. No error logs were captured during these checks. The temporary host and tab were closed afterwards.
8. The retained user's workspace initially had no shared calendar and no action records. A private local rollback backup was kept, its existing **19:00–20:30** project window was explicitly adopted, and the new shared week was started on **13 October**. Strict before/after state comparison confirms that only the shared-calendar object changed; original project plans, sources, actions, optical arrangements and work history are identical. The empty calendar exposes Add an action as its primary control. No sample tasks, reservations or work outcomes were inserted into that workspace. These private backup files stay in ignored `.runtime/`, outside publication inputs.

## Evidence

- [Matched day view](week-refinement-day.png), [night view](week-refinement-night.png)
- [Phone day inspector](week-refinement-phone.png), [complete compact movement form](week-refinement-compact.png)
- [Unreserved proposal](week-refinement-proposed.png), [static edition](week-refinement-static.png)
- [Before proposal](week-refinement-before.json), [during proposal](week-refinement-preview.json), [accepted workspace](week-refinement-workspace.json), [matching calendar](week-refinement-calendar.ics)

The screenshot API returned JPEG content. These images were decoded and saved as PNG without resizing or changing their content. Native captured content areas are **1351 × 890** desktop/proposal, **375 × 812** phone, **653 × 506** compact and **1265 × 712** static. Screenshots show the actual application and synthetic fixture; they are not generated design concepts.

## Limits

This is still a deterministic seven-day planner, with explicit manual commitments and acceptance. It does not synchronize a calendar, measure attention, grade understanding or infer completed work. Placement choices are alternatives, not a second automatic plan. Selecting a task for future planning does not make its unfinished prerequisites complete. The original released acceptance report and evidence remain retained; this file documents the local refinement.
