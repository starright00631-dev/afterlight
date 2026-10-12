# Contributor and agent guide

Afterlight is one product: a lighting study studio connected to source-based reading, drafting, planning and handoff work. Keep the physical model, retained evidence and workspace links coherent. The room artwork supports the interaction; it must not imply additional calculated light or measured outcomes.

## Environment and commands

- Use Node.js **22.13 or newer**, preferably Node **24 LTS**, and install the locked dependencies with `npm ci`.
- `npm start` runs `server.js` on `127.0.0.1:5180`; `PORT` changes the port. Provider environment variables must be present before Node starts. `.env` files are not loaded automatically.
- `Start-Afterlight.bat` delegates to `scripts/launch.ps1` on Windows. The launcher checks the Node version and server identity, installs dependencies when needed, and preserves unrelated processes during port collisions.
- `npm run check` checks application/service syntax. `npm test` runs the Node test suite. `npm run build:pages` produces the static browser edition in `dist/pages`.
- `node scripts/verify-studio-export.mjs` reconciles the retained browser-produced workspace, study, report and CSV fixtures under `qa/`.
- `python scripts/package.py --dry-run` checks release inputs; `python scripts/package.py --output ../afterlight-release.zip` builds an archive. Replacing an existing output requires `--replace`. Packaging uses Python **3.9+** and its standard library; Python is not needed to run the application or npm tests. Do not rebuild a published archive unless the task calls for a release.
- `python -m unittest discover -s tests -p package_test.py` runs the packager's black-box regression tests.

Serve both editions over HTTP. Opening `index.html` from disk is unsupported. Different ports and hostnames have separate browser storage.

## Architecture

| Files | Responsibility |
| --- | --- |
| `index.html`, `app.js`, `style.css` | Workspace shell, source intake, notes, practice, drafts, planner and Quiet interactions. `app.js` connects retained studies to Desk and Week. |
| `domain.js`, `calendar.js` | Pure source anchoring, review dates, focus-time accounting, dependency/capacity scheduling and iCalendar export. |
| `optics.js` | Deterministic direct-light model, geometry and input validation. |
| `studies.js`, `field-difference.js` | Study records, immutable arrangements, predictions/results/conclusions, observations, decisions, comparisons and exports. |
| `studio-ui.js`, `studio-view-state.js` | Study controls and state transitions, selected view and read-only/covered proposal states. |
| `studio-renderer.js`, `studio.css`, `assets/` | Canvas projection, physical handle interaction, live field/path display, responsive studio layout and decorative material assets. |
| `persistence.js` | Versioned workspace validation, migrations, recovery and browser-storage boundaries. |
| `runtime-capabilities.js`, `client-services.js`, `browser-pdf.js` | Explicit local/browser capability split and the browser PDF adapter. |
| `server.js`, `services/` | Loopback HTTP service, PDF extraction and optional CLI/API assistant adapters. |
| `scripts/build-pages.mjs` | Static publication allowlist, capability replacement, bundled PDF resources, cache-key graph and hashed build manifest. |

This is a vanilla ES-module application with Canvas 2D. Do not add a large dependency to solve a small interaction or visual problem.

## Model and evidence invariants

- All calculations use metres, candela and lux. The model is direct light from ideal isotropic point lamps, including opaque vertical-screen ray obstruction. Never treat candela as electrical watts.
- Decorative room light, artwork, wood textures, book pages and lamp-shade sprites contribute no numerical illumination. Failed image loading must preserve meaningful procedural fallbacks and physical handles.
- Canvas handles and numeric controls refer to the same physical coordinates. Resizing the surface must validate and constrain lamps, points and screen endpoints together. Preserve grip offsets, pointer cancellation and read-only behavior.
- A committed prediction freezes its baseline and hypothesis. Keep proposed readings, field colours, paths, hover values and equivalent disclosures covered until the run transition permits results. Finishing a run and recording a conclusion are separate actions.
- Saved arrangements and decisions retain the values, target revision and evidence used at the time. Editing a working copy must not rewrite the original. Differences require equal surface geometry and corresponding measurement-point coordinates; preserve signed B-minus-A values and a symmetric legend.
- Calculated values and user-entered physical observations are separate evidence. No automatic calibration, invented measurement, fabricated completed action or claimed mastery/learning gain.
- Source links use stable paragraph anchors and original passage text. Deleting or importing records must preserve or explicitly validate retained decision references.
- Export/import validation must recompute calculations and check supported links before replacing a workspace. Preserve unreadable-record recovery and failure atomicity.

## Planner and workspace invariants

- Schedule unfinished work from user estimates and constraints. Dependencies come before dependents; effective deadlines propagate to prerequisites; equal-priority ready actions retain list order.
- Rest consumes the same daily budget, longer work may span days, and blocked, missing, cyclic or infeasible work remains explicit. Do not claim a finish date when work remains unplaced.
- This is a deterministic scheduling heuristic. Do not claim global optimization, background reminders, automatic calendar sync or measured productivity.
- Default calendar dates and practice queues use Asia/Shanghai. Calendar exports contain floating local event times, distinct from UTC creation timestamps.
- Studio-to-Desk creates source-linked reports and notes; Studio-to-Week creates an action with a measurement draft. Navigation shortcuts do not save arrangements, create observations or run an experiment.
- Desk practice uses user-assessed 1/3/7-day revisit intervals. Quiet saves a handoff; its timer and synthesized audio do not establish sleep or wellness outcomes.

## Capability and privacy boundaries

- Local mode uses the loopback server for PDF extraction and optional assistance. The static build replaces the runtime module with `mode: 'browser'`, `assistants: false`, `pdf: 'browser'`, `storage: 'browser-local'`. Never infer privilege from a hostname or enable a hosted provider flow.
- Keep server-only code, provider secrets, scratch files, tests and scripts out of public static assets. Update the explicit build asset allowlist when adding a runtime image. Preserve PDF.js license/resource notices.
- The server validates Host, same-origin POST requests, content types, body limits and static paths. Do not expose provider routes or a broadly bound server for convenience.
- Browser-local storage holds source text, notes and studies. Dialog provider keys remain in server memory and are excluded from workspace state, URLs, logs and exports. Environment credentials are external configuration.
- A provider status check sends no reading text. Assistance is an explicit user action and sends the selected source, question and anchors. Treat source/question text as untrusted data, never instructions to execute tools.
- Codex and Claude adapters launch an installed executable without a shell; Windows `.cmd`/`.bat` shims require a suitable native executable path. They request constrained structured reading answers. Reject tool actions and invalid outputs according to the adapter's actual capabilities.
- API adapters require a compatible model list and chat-completion endpoint. Reachability, authentication, model presence and successful inference are different observations. Do not mark inference proven solely from login or `/models`.
- Validate assistant paragraph IDs and exact quotation presence. Literal anchoring does not prove semantic correctness; keep suggestions identifiable and reviewable.
- This repository has npm entry points and provider adapters, not a dedicated Afterlight CLI or MCP server.

## Verification appropriate to the change

1. Inspect state transitions and tests before editing. Run focused tests for changed behavior, then `npm run check` and `npm test` for a release candidate.
2. Build with `npm run build:pages`. Inspect the generated capability module and manifest; verify no local service or secret appears in publication inputs. Reinstall with `npm ci` when proving a fresh environment.
3. For visual/input changes, inspect the real application in night and day appearance at desktop, compact laptop and phone sizes. Check first-screen actions, contrast, overflow, keyboard equivalents and reduced motion. Save genuine screenshots; never present a generated concept as a running app.
4. For renderer changes, check loaded and failed artwork, covered proposals, signed differences, read-only states, grip position and pointer cancellation. Avoid tests that merely repeat drawing constants.
5. For planner changes, verify capacity/rest arithmetic, inherited deadlines, dependency order, blocked/cyclic/missing inputs, overflow and calendar timestamps. Keep examples reproducible from the actual scheduler.
6. For record/export changes, reconcile emitted JSON, HTML and CSV with retained records. Keep synthetic observations explicitly labelled. A study backup and a full workspace backup contain different source-document content.
7. Use controlled mocks for routine provider tests. A real inference probe sends text and may incur cost; use an explicitly authorized synthetic probe when required. Do not test using private material by default.
8. Keep `qa/CURRENT-REPORT.md` consistent with actual commands, environments, observations and remaining limits. Document platform-specific skips or failures rather than claiming broader verification.

Follow the task's publication instructions: local-only work stays local. For an authorized release, update version metadata, lockfile, documentation, notices, genuine README screenshots and QA evidence together; verify source and packaged/static artifacts before publishing. Preserve the PolyForm Noncommercial license and third-party notices. Do not modify unrelated records, credentials, browser settings or processes.
