> Planning and source-research record. Use the delivery README and qa/CURRENT-REPORT.md for implemented behaviour and current verification.

## Context

The problem and scope are described in the delivery README. Afterlight uses native ES modules, canvas, browser persistence and a loopback Node server. Its current direct-light evaluator already accepts bounded custom dimensions and up to four detectors, but the interface exposes fixed exercises. Existing experiments validate predictions against recomputed scene readings. The lab is global while notes and plans are project-owned; transferring an experiment currently creates a generic writing task in the selected project.

The read-only audit passed the existing 64 tests. This is baseline evidence, not verification of the proposed features. The current result and conclusion can be lost after Run clears the persisted pending prediction; they need a durable intermediate state.

## Goals / Non-Goals

**Goals:** Finish an understandable lighting study for a task surface, make the path from source to experiment to decision inspectable, and restore the previous project's visual quality within one Afterlight experience. Use the same model for all views and outputs.

**Non-Goals:** Professional fixture selection, certified lighting compliance, glare/comfort/energy calculations, full-room photorealistic ray tracing, arbitrary document-to-simulation generation, another subject or another application. Targets describe the user's study, not prescribed standards.

## Decisions

### One work product: a lighting study

The primary unit is a study with an explicit identity and owner: task, question, surface dimensions, named measurement points, personal targets, alternatives, experiments, chosen arrangement, decision reason and next check. New studies require an explicit project association. Changing the legacy Desk project cannot silently reassign a study or its evidence. A legacy global lab becomes a clearly labelled recovered study with unresolved ownership until the user associates it.

Studio performs the work. Studies resumes and compares saved work. Field guide explains the model and opens source passages and optional assistance in the current study context. Studio, Desk, Library, Week and Quiet remain visible destinations, following the latest user instruction. Studies and Field guide are contextual Studio tools. A study decision creates retained report evidence in Desk; an estimated real check enters Week with a structured study link; Quiet retains a handoff and a return to the study. Library preserves its source role.

The alternative of adding another landing page or a second app would preserve the current discontinuity. Merely placing the existing planner beside a nicer lab would also leave the decision artefact missing.

### Bound the first useful editor

Support surfaces from 0.3 to 12 metres on each axis, one or two ideal lamps, two to four labelled horizontal points, and one optional vertical opaque screen. The smaller minimum admits ordinary desks; update scene validation while preserving all legacy challenge geometry. Expose point positions and names, surface dimensions, lamp position/intensity/height and screen endpoints/height with both direct manipulation and labelled numeric controls. Offer a small shared-table template; clearly mark its data as an example. Fresh personal studies have no fabricated experiments or observations.

The brief sets a shared illuminance range, minimum point uniformity and optional total intensity ceiling. Show readings and status for each point. Uniformity means minimum divided by maximum across selected points; neither it nor their average describes the whole surface. Zero-output and all-zero cases retain the evaluator's defined behaviour rather than producing NaN or a flattering percentage.

These are personal-study authoring bounds. Commissions and recovered legacy records retain their existing valid geometry, including a one-point distance commission or up to three legacy screens. Upgrading must not discard otherwise valid records merely because the new editor is more focused.

Retain the current ideal-source formula and occlusion checks. Candela stays candela. Electrical watts, directional real-fixture photometry and reflected/ambient light require different information and models. A real observed value can help someone question the model; it does not turn this simplified calculation into a compliance result.

### Separate alternatives, interventions and observations

An alternative is an immutable scene snapshot with its identity, study geometry revision, creation time and model version. Keep an editable current scene independently, so changing it cannot mutate a saved option. Compare two alternatives under the same named points, surface geometry and current target revision; display the target version used. If measurement geometry differs, label them different setups and require restoring common geometry before a matched comparison.

Match the actual dimensions and stable point identities/coordinates, not geometry revision numbers alone. Identical restored geometry can be compared even after a revision changes; a coincident revision cannot make different geometry comparable. A retained decision freezes the compared alternative identities, target revision and values, calculated comparison/model version and its evidence links. Later target changes can show a new evaluation beside that decision but cannot silently change its rationale or historical report.

Restoring common geometry creates an editable branch/new alternative rather than modifying an original. Resizing rejects out-of-bounds lamps, points or screen endpoints until the user resolves them explicitly; it does not silently move the objects.

A controlled experiment continues to freeze its baseline, selected point and prediction before changed readings are revealed. Changing point geometry during an experiment requires cancellation or a new setup. Multiple changed conditions can remain a recorded comparison, with an explicit explanation that they do not isolate one cause.

Introduce a persisted staged-result record after Run: baseline/final scenes, derived readings, original prediction/hypothesis, editable conclusion and stage. Refresh restores that record. Finalize saves it to the notebook exactly once; discard is explicit. A correct direction prediction does not automatically validate an explanation or grant a mastery score.

Keep a staged result independent of the editable scene. Restoring an alternative, resetting conditions or switching commissions must retain a visible route back to it. A new Run in that study requires finalizing or explicitly discarding its earlier staged result; selecting another study preserves each study's own stage.

Give the stage a stable identity. Finalization adds its uniquely identified experiment and clears the stage in one validated workspace save. A failed save retains the recoverable stage and reports failure. During a committed prediction, show a labelled proposed-geometry view without future field/readings; a separate Baseline view shows the frozen field, equipment and readings together. Run reveals the final field. Never combine a baseline field with unlabelled changed equipment.

Optional observed readings are separate records with study/alternative/point references, finite non-negative lux, instrument or method, observation timestamp and context. Show observed and calculated columns separately, with an arithmetic difference. Do not infer fixture intensity, overwrite calculated output or claim the residual proves why the model differs.

An observation always refers to its immutable saved arrangement, not whichever editable scene is current. Calculated evidence and decision exports identify their supported model version. Reject unsupported imported model versions explicitly, leaving the current workspace and original file intact rather than silently recomputing them under different rules.

### Produce an evidence report

Use a pure study/comparison/report layer shared by UI and exports. Reports contain the task and chosen arrangement, both configurations, dimensions and coordinates, point readings, targets and margins, explanation of the choice, linked experiment/hypothesis/conclusion, sources, exact model version, assumptions and a next-measurement checklist. CSV exports calculated values with units and configuration identity. JSON restores full study history and relationships.

A printable HTML report uses semantic text, a vector/canvas-generated scene preview and print CSS; it does not require a new PDF library or an online renderer. Formula/source links remain readable when printed. Exported content is escaped, and imported derived readings are recomputed. Credentials and provider connection settings remain outside study exports.

CSV text cells must be safe when opened in spreadsheet software, including labels starting with formula-trigger characters or leading control whitespace. Preserve the literal prose in JSON/HTML while neutralizing those CSV string cells. Genuine numeric values, including negative differences, remain numeric.

### Give the science a place

Day and night concept sketches informed the visual direction. Those generated images are excluded from this release and were never functioning screens or scientifically calibrated fields. The decorative room, plants, books and reflected-looking highlights establish atmosphere; the implemented field, screen silhouette, paths and readings must come from the model. Decorative elements do not act as unmodelled optical blockers.

Keep the existing Afterlight brand. Use restrained serif display typography, readable humanist body/control typography, tabular numbers, warm paper in day appearance, deep petroleum/forest ink at night, and brass for selection. Draw a distinctive bench with visible light, not an oversized empty grid. Use a shared coordinate transform for drawing, hit testing and keyboard/numeric input.

Desktop: a quiet chapter rail, a dominant stage, compact contextual inspector, integrated readings and one primary stage action. The three commissions teach distance, shadow and balance using that same studio; the personal study is their destination. The atmosphere supports real rules and a named task rather than replacing them with fantasy jargon.

At 1366×900, show the stage, brief, selected-point readings and primary action together. At 668×518, compact the heading and move detailed controls into an accessible inspector, keeping stage, selected reading and primary action in view. At 390×844, use a small horizontal chapter selector, stage followed by readings and the action, then controls. Preserve focus, readable labels, no horizontal overflow, and reduced-motion preferences. Appearance changes do not alter model geometry, results or saved evidence.

### Reuse principles from source, not incompatible engines

Research and exact source links are in the adjacent research.md. Ray Optics demonstrates editable scenes, quantitative exports and scene persistence; its ray-detector units differ from this horizontal lux model. LOOPY demonstrates restorable remixes, useful for branching an alternative from retained evidence. PhET's deployed simulations demonstrate controlled discovery, but the current public repository explicitly says it is outdated. Get It remains a reference for context-preserving movement between a source, concept and assistance.

Keep the current stack and pure evaluator. No external simulation engine or copied source is required for this scope. Complete source repositories do not need REA. Use REA later only if a claim depends on a packaged artefact/runtime rather than available source.

## Risks / Trade-offs

- [Illustration can imply a more complete physics model] → Keep calculated fields model-driven, explain the idealisation beside the readings, and label concept art and examples explicitly.
- [User chooses points that hide dim regions] → Label all aggregate results as point-based, show every point coordinate, and include a next-check recommendation to sample other locations.
- [Saved comparisons become invalid after geometry edits] → Bind alternatives to geometry revisions; prohibit a matched-comparison claim across different setups.
- [Legacy global lab ownership is unknowable] → Recover it without assigning it to an unrelated project, then offer an explicit association.
- [Migration or UI simplification loses work] → Retain old data, validate the complete upgraded workspace before saving, and test notes, plans, handoffs and provider separation.
- [More controls recreate the long form] → Make selection contextual, put detailed geometry in the inspector, and verify the smallest real panel before polishing the wide screen.

## Migration Plan

1. Capture a validated v2 export and preserve the current 2.1.0 release outside the submission path.
2. Introduce a v3 workspace and separate storage key. Migrate only when no v3 workspace exists: read v2 once, create a recovered study for the global lab, preserve original project/source/action/idea identifiers, practice attempts, running/paused focus sessions, quiet timers and appearance preferences, and keep the v2 storage untouched. Existing valid v3 takes precedence. Invalid v3 is preserved and reported instead of being replaced by v2. Reject broken references and preserve unreadable raw data rather than silently replacing it.
3. Upgrade UI navigation while retaining routes to existing work. Implement study state and recovery before switching the default screen.
4. Verify v2 migration, v3 round trips, analytical readings, alternative independence, invalidated comparisons, recovered results, observation separation and exact report/CSV contents. Exercise the actual browser at desktop, compact panel and mobile widths in both appearances.
5. Package one afterlight/ root with app source, lockfile, tests, setup, credits, self-contained textual design/spec rationale and a single current QA entry point. Keep source clones, old builds, concept art, historical REA payloads and previous QA captures outside the submission. Verify archive CRC and all payload member hashes; the manifest excludes its own hash, which is recorded with the archive hash in an external release receipt. Packaged rationale remains understandable without workspace-only concept references.

Rollback restores the prior application with the untouched v2 workspace. New v3 studies remain available in their export/storage and require the upgraded application; rollback must not pretend the older app understands them.
