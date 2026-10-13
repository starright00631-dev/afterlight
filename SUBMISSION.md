# Afterlight · Turn knowledge into playable action

**Midnight Academy submission | Application version 3.4.0**

Afterlight is an interactive lighting studio and a source-linked learning workspace. Adjust a scene, commit a prediction and test an explanation. Keep the resulting evidence, connect it to a reading or decision, and give the next useful action a place in a shared calendar. At the end of work, retain the output and a clear place to resume.

The day/night reading room provides the setting. The practical connection is **question → prediction → evidence → decision → concrete action → accepted time → reported outcome**.

[Live demo](https://starright00631-dev.github.io/afterlight/) · [Source repository](https://github.com/starright00631-dev/afterlight) · [3.4.0 release](https://github.com/starright00631-dev/afterlight/releases/tag/v3.4.0) · [AI use](AI_USAGE.md) · [Deployment guide](DEPLOYMENT.md) · [Three-minute demonstration](SUBMISSION-DEMO.md)

![The running night lighting studio](screenshots/01-studio-night.png)

## Implementation status

| Feature | Status | Working behavior |
| --- | --- | --- |
| Lighting studio | Implemented | Move lamps and measurement points; change height, intensity, table dimensions and screens; inspect calculated lux, fields and paths. |
| Prediction and evidence | Implemented | Commit a prediction before revealing results; preserve original conditions, explanation, results and separate conclusions; compare matching saved arrangements and retain a reasoned decision. |
| Reading and sources | Implemented | Preview PDF, text or Markdown before explicitly saving it; attach notes, questions and actions to original paragraphs. |
| Source-linked review | Implemented | Write while references are hidden, then reveal the passage and personal criteria; explicitly assess, skip or undo; retain the question and passage used at assessment time. |
| Shared planning | Implemented | Projects share availability, commitments, closed dates and rest; respect prerequisites, deadlines and remaining estimates; explain work that does not fit. |
| Calendar visualization | Implemented | Seven days share one clock scale; select a day to inspect reservations and gaps; compare Accepted/Proposed, then explicitly accept sessions. |
| Work and handoff | Implemented | Start explicitly; use Quiet to record finished, partial or blocked work, output, remaining effort and next step. A timer does not complete a task. |
| File exchange | Implemented | Complete workspace JSON backup/restore, accepted-session ICS, lighting HTML reports, Excel CSV and individual study JSON. |
| Appearance and small screens | Implemented | Day/night share the same data; desktop panels stack on smaller screens; labelled controls support touch and keyboard access. |
| Optional model assistance | Implemented; needs a configured environment | Local CLI or compatible API adapters are available. The hosted demo disables assistance. Release checks do not establish real model inference. |
| OCR, calendar-account synchronization, automatic grading | Not implemented | Scanned pages need a transcript, calendar export is a snapshot, and review is self-assessed. |

![The running shared calendar and selected-day inspector](screenshots/03-week-day.png)

## What knowledge becomes playable?

Lighting experiments make distance, incidence angle, additive intensity and direct obstruction adjustable and testable. The model uses metres, candela and lux. An ideal point lamp contributes to a horizontal sample point:

```text
E = I × h / (dx² + dy² + h²)^(3/2)
```

Directly beneath the lamp this becomes `E = I / h²`. Keep intensity at **32 cd** and change height from **0.8 m** to **0.4 m**: the calculation changes from **50 lx** to **200 lx**. These are model outputs, not physical-room measurements.

Your reading supplies another kind of knowledge: retain the original passage, your explanation, a recall question and answer criteria, then turn it into an inspectable output. The planner asks whether that next action fits the available time; planning it does not establish that it happened.

## Run on your own computer

### Use the hosted demo

Open [the public demo](https://starright00631-dev.github.io/afterlight/) from any suitable computer. No local installation or model account is needed. The demo and each local address have separate browser records.

### Install locally

Install **Node.js 22.13 or newer**, preferably Node 24 LTS. Extract the entire submission folder. First dependency installation requires internet access.

On Windows, double-click **Start-Afterlight.bat**. On Windows, macOS or Linux, open a terminal in the extracted folder and run:

```bash
npm ci
npm start
```

Read the address printed by the launcher/server; the default is `http://127.0.0.1:5180/`. **127.0.0.1 means the computer you are using**, so run Afterlight on that computer before opening its local address. It is not a shared public link or the developer's computer address. The application folder can be anywhere; no `D:\work` path is required.

### Choose another port

If 5180 is occupied, choose an unused port explicitly. For example, from the application folder on Windows:

```powershell
.\Start-Afterlight.bat -Port 5188
```

Or start the server in PowerShell:

```powershell
$env:PORT = '5188'
npm start
```

On macOS/Linux:

```bash
PORT=5188 npm start
```

Open the resulting `http://127.0.0.1:5188/`. This example is configurable, not a required entry point. The launcher preserves unrelated processes and never silently chooses a different port. Changing a hostname or port changes the browser storage origin; export a workspace backup before moving. Use one active tab per workspace because simultaneous edits are not merged.

For a link other people can open on their own devices, follow [the deployment guide](DEPLOYMENT.md). Keep the local provider server on loopback; publish the generated static browser edition. Opening `index.html` directly from disk is unsupported.

## Inspect the source

```bash
npm run check
npm test
node scripts/verify-studio-export.mjs
node scripts/verify-workbench-export.mjs
node scripts/verify-week-refinement.mjs
npm run build:pages
```

The [independent submission ZIP](https://github.com/starright00631-dev/afterlight/releases/download/v3.4.0/afterlight-submission.zip) includes application code, locked dependencies, a browser build, Node tests and a Pages workflow. That ZIP excludes private conversations, original image-generation prompts, development research archives, installed dependencies and credentials. The public repository retains its existing maintenance history and attribution. Deliberate multilingual PDF fixtures remain in the tests to check text extraction; submission documentation is in English.

## Core files

| Files | Responsibility |
| --- | --- |
| `index.html`, `app.js`, `style.css` | The five workspace destinations and their connections. |
| `optics.js` | Direct illuminance, obstruction, physical coordinates and input validation. |
| `studio-renderer.js`, `studio.css` | Live projection, dragging, fields, paths and material rendering. |
| `studies.js`, `field-difference.js` | Frozen predictions, saved arrangements, comparison, decisions and evidence exports. |
| `studio-ui.js`, `studio-view-state.js` | Study controls, covered results and read-only states. |
| `source-intake.js`, `browser-pdf.js`, `services/pdf.js` | Read-only intake previews, explicit saving and PDF text extraction. |
| `domain.js` | Source paragraphs, anchors, review dates and basic records. |
| `workspace-planner.js`, `calendar.js` | Shared capacity, dependencies, placement checks and calendar exports. |
| `agenda-ui.js`, `calendar-overview.js`, `calendar-overview.css`, `planning-inspector.js` | The week map, selected-day context, reservation management and validated placement alternatives. |
| `review-sessions.js`, `review-ui.js` | Bounded queues, reveal/assessment snapshots and Undo. |
| `workbench-state.js`, `work-sessions.js` | Allocation links, actual outcomes and remaining estimates. |
| `persistence.js` | v4 workspace validation, v3/v2 migration and recovery. |
| `server.js`, `client-services.js`, `runtime-capabilities.js`, `services/` | Local HTTP/PDF and optional assistance; explicit local/hosted boundaries. |
| `scripts/`, `tests/`, `.github/workflows/pages.yml` | Windows launch, static build, checks and deployment. |
| `assets/`, `licenses/` | Decorative assets, identity and third-party licenses. |

## Submission materials

| Requirement | Location |
| --- | --- |
| Source and entry point | Application files, `services/`, `scripts/`, `tests/`; `Start-Afterlight.bat` or `npm start`. |
| Project, status and core files | This overview and the repository README. |
| AI participation | [AI_USAGE.md](AI_USAGE.md). |
| Prompt material | [ai-logs/](ai-logs/README.md): clearly labelled reconstructed examples, **not original conversations or historical logs**. Original conversations remain private; organizer acceptance of this alternative is unconfirmed. |
| Actual screenshots | [screenshots/](screenshots/README.md): six images from the running app. |
| Demonstration | [Live website](https://starright00631-dev.github.io/afterlight/) and [180-second demonstration route](SUBMISSION-DEMO.md). The route is not a recorded video. |
| Installation and publication | [DEPLOYMENT.md](DEPLOYMENT.md). |
| Verification | [VERIFICATION.md](SUBMISSION-VERIFICATION.md). |
| Asset provenance | Existing repository attribution is in [CREDITS.md](CREDITS.md). The independent ZIP contains a public summary without original generation prompts. |

## Limits and license

The lighting room is a Canvas 2D projection and an ideal direct-light model. It omits ambient light, reflections, glare, spectrum and physical-room calibration. Decorations contribute no numerical illumination. Candela is not electrical power; targets are personal or exercise goals, not compliance certifications.

PDF intake requires extractable text and is bounded at **20 MiB, 80 pages, 120,000 characters and 2,000 paragraphs**. It has no OCR or original-page viewer. Planning is a deterministic heuristic; source review uses fixed **1/3/7-day** self-assessed revisit intervals. No productivity, mastery, learning or sleep benefit is established.

Original code, documentation and artwork are source-available for noncommercial use under [PolyForm Noncommercial 1.0.0](LICENSE). Preserve [NOTICE](NOTICE), [third-party notices](THIRD-PARTY-NOTICES.md) and `licenses/`. PDF.js retains Apache 2.0 terms; its optional local Canvas dependency retains MIT terms.
