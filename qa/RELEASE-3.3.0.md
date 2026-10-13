# Afterlight 3.3.0 — release verification

Verified on 2026-10-12. This release includes the local tabletop refinements, book/record navigation, coherent table resizing, larger README screenshots and standalone release packaging. The underlying ideal point-source model and retained study format are unchanged.

## Environment and automated checks

| Check | Result |
| --- | --- |
| Windows x64, Node 24.15.0 / npm 11.12.1, `npm test` | 146 passed; 0 failed, skipped or cancelled |
| Windows x64, Node 22.13.0 / npm 10.9.2, `npm test` | 146 passed; 0 failed, skipped or cancelled |
| `npm run check` on both versions | Passed |
| Standard-library packaging regressions | 4 passed |
| Retained study, HTML and calculated CSV reconciliation | Passed; all fields and exporter bytes matched |
| `npm run build:pages` | Passed; 234 public files, PDF.js 6.4.299 |

The minimum-version runtime was downloaded from the official Node.js release and its ZIP SHA-256 matched the official SHASUMS256.txt. It was used only in child processes; installed Node and system PATH were unchanged. The test script uses `--experimental-test-isolation=none`, which works on both tested Node versions; the unprefixed flag from 3.2.0 was incompatible with Node 22.13.

The GitHub verification workflow runs Node 22.13.0 and Node 24 on Windows and Ubuntu, including syntax checks, application tests, packaging regressions, export reconciliation and the browser build. Windows launcher tests are intentionally skipped on non-Windows hosts. [Workflow results](https://github.com/starright00631-dev/afterlight/actions/workflows/ci.yml) identify the actual outcome for each revision. A separate Pages workflow validates and deploys the static application.

Browser build ID: `b41717f3653bd3c293b231fc4cac8df928b76ef3a55fe63d51f0c6c7218f2284`. This identifies authored browser modules, runtime capabilities and illustration assets; documentation-only changes do not alter it.

## Reading-table acceptance

- Surface geometry, rulers, field samples and inverse pointer positions share one orthographic transform. Size changes submit width and depth atomically. Invalid shrinking preserves the previous scene and explains equipment outside the proposed bounds; coordinates do not silently rescale or clamp.
- Neutral oak, book and brass assets retain live light compositing. Disabled or fully blocked contributions add no pool light. Procedural drawing remains available when image loading fails. Day/night atmosphere does not affect the scientific calculation.
- Off-centre drags preserve the original grip, including compact and short fixture offsets. Focused tests cover small first movements, zero-motion selection, bounds, pointer ownership, cancellation, read-only changes and fallback-to-loaded artwork.
- The book opens the real Field guide; the notebook opens the actual study record. Return to table restores canvas focus. Navigation does not create records or edit geometry. Touch requires a matching release; movement, cancellation, capture loss or a disappearing prop does not activate a shortcut. Ordinary labelled controls supply keyboard access when decorative paper is omitted.
- Covered prediction readings and rasters remain covered. Signed differences retain symmetric scale limits and B minus A values. Hover cues supply action names without revealing numerical results.

The preceding local acceptance inspected 1366 × 900 desktop, 390 × 844 phone and 668 × 518 compact layouts. Neither smaller layout overflowed horizontally; the primary action fit inside each viewport. Native off-centre dragging matched numeric controls, paper and keyboard shortcuts reached the intended destinations, and read-only navigation kept geometry controls disabled. These checks are complemented by current automated input, route, resize and raster regressions.

## Actual 3.3 browser and planner checks

Public README images were captured from a separate local example workspace using the running 3.3.0 application. They show no private workspace or provider credentials.

- The shared-table example has a 2.4 × 1.2 m surface, two 40 cd lamps at height 0.5 m, positions (0.8, 0.6)/(1.6, 0.6), and two matching measurement points. Both readings are 183.8 lx, selected-point uniformity is 100%, and enabled intensity is 80 cd. These values survived reload and day/night switching.
- The explicitly labelled built-in research-brief project contains the real 30 → 45 → 60 → 30 minute dependency chain. At 90 minutes per day, 19:00 start and five-minute rest gaps, the planner puts 165 minutes of work plus 15 minutes of rest into two days. The 60-minute draft spans five minutes on the first day and 55 on the second. The UI displayed these blocks and the correct completion date. Export calendar reported scheduled blocks exported; automated calendar tests verify the generated data.
- Desk displayed the retained passages, two linked ideas and its existing practice/draft actions. Its local Codex status reported a signed-in account and explicitly stated that authentication status does not test inference. No assistance request or source submission was made for this release check.

| README capture | Dimensions | What it shows |
| --- | --- | --- |
| [Night Studio](readme-studio-night.png) | 1905 × 972 | Live balanced example, brass fixtures and reading objects |
| [Day Studio](readme-studio-day.png) | 1905 × 972 | Same geometry and calculated results |
| [Week planner](readme-planner.png) | 1905 × 972 | Authored dependency/capacity example and scheduled blocks |

Browser capture supplied JPEG pixels. They were transcoded to PNG without resizing, upscaling, retouching or generated UI substitutions. README displays individual linked images at full available width. Prior smaller acceptance captures and deterministic export fixtures remain available; they are not presented as newly recorded experiments.

## CLI, runtime and packaging contract

Afterlight has no standalone `afterlight` command or MCP server. `npm start` starts its loopback Node server. `Start-Afterlight.bat` invokes the Windows launcher, checks the supported Node version, installs locked dependencies if needed, and verifies application/version/root identity before opening or reusing a server. Port conflicts do not terminate unrelated processes.

Local optional assistance supports Codex CLI, Claude CLI, Ollama, DeepSeek and OpenAI-compatible APIs. Installed Codex 0.159.1 and Claude Code 2.1.247 version/help checks confirmed the used flags. Native CLI child-process version checks passed. Windows requires a directly executable native binary; `AFTERLIGHT_CODEX_PATH` / `AFTERLIGHT_CLAUDE_PATH` can point to it. A `.cmd`-only wrapper is insufficient with the deliberate `shell:false` boundary. Authentication and connection probes are separate from inference; compatible provider access still depends on the user's endpoint, account and model.

The static build disables all provider connections and keeps PDF reading in the browser. Core Studio, Desk, Library, Week, Quiet and exports need no model provider. Opening `index.html` from disk is unsupported; serve the application over HTTP.

Release packaging reads committed repository documentation exclusively. A sibling development OpenSpec store cannot alter release bytes. Standard-library tests build a standalone spaced checkout without node_modules or an OpenSpec store, reconcile every ZIP member/hash, prove same-input reproducibility and exact documentation bytes, and verify replacement refusal, required-evidence failures, private-input exclusion and preserved prior archives. Python 3.9+ is required only for maintainers building the ZIP.

A real 3.3.0 candidate was extracted into a fresh directory containing spaces, without installed dependencies. Invoking its actual BAT from outside that directory installed three locked packages and reached matching loopback health. A second invocation reused the same verified PID. Ten served application/module/style/artwork/PNG files matched the extracted bytes by SHA-256. Its standalone packaging dry-run resolved all 96 public payload files without a sibling planning store. The extracted application mounted in the browser with the expected starter values and no captured warning/error logs. Library and Quiet also remained available in the separate release example workspace.

The ZIP manifest lists payload sizes and SHA-256 hashes, excluding its own hash; the external receipt records archive and manifest hashes. Runtime logs, portable QA binaries, credentials, installed dependencies, caches, raw forensic records and unrelated prototypes are excluded. Source and artwork retain PolyForm Noncommercial 1.0.0; third-party notices remain separate.

## Limits

This is illustrative Canvas2D relief with an ideal direct-light calculation, not a full 3D lighting engine or calibrated physical-room model. Targets are personal goals. No learning, sleep, comfort, compliance or productivity outcome has been established. The retained export fixture's observation remains explicitly synthetic; no real meter readings were fabricated. Local provider inference, printed-PDF pagination and every possible browser/device/provider configuration have not been tested by this release pass. Workspace data stays local to each browser origin; changing origin requires an explicit backup/import.
