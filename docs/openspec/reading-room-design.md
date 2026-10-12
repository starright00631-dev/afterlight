## Context

See `proposal.md` for motivation and `evidence.md` for source and package findings. The 3.0 baseline uses ES modules, a single Canvas 2D stage, DOM controls and the existing immutable study model. `studio-renderer.js` already shares one transform across drawing and pointer hit testing, obtains illumination from `optics.js`, and hides proposed readings until an experiment runs. `studio-ui.js` already owns saving, prediction, comparison and choice through the domain module. The redesign must preserve those contracts rather than create a second application.

The two approved concepts are 1536×1024 design images, with a large furnished room, table, compact right brief and restrained controls. They also contain illustrative values and a prewritten choice. They are art direction, not a source of saved user evidence or a literal application background.

## Goals / Non-Goals

**Goals:**

- Make the room feel richly illustrated while every actionable object and numerical display remains live and inspectable.
- Make the scientific sequence reachable through four genuine actions with honest prerequisite states.
- Add an honest signed spatial comparison without changing the optical equations, storage version or retained evidence.
- Make the existing workspace and retained records readable in both appearances and across the specified viewport sizes.

**Non-Goals:**

- Add a renderer framework, arbitrary runtime generated scene code, new provider behavior, automatic mastery scoring or an untested physical lighting model.
- Import screenshot numbers, fabricated experiment history or a prewritten decision into fresh storage.
- Claim reflected daylight, rendered room shadows or decorative objects are included in lux calculations.

## Decisions

### Compose art around the real stage

Use original generated room art as a day/night environmental layer and, where appropriate, a reusable wood material. Draw the variable-size task surface, editable lamps/screens/points, paths, dimensions, field and labels using the existing scene transform. All DOM text, buttons, readings and state labels remain real elements. A procedural fallback stays available if an image is missing or slow.

This separates visual richness from scientific identity: decor can be ornate without pretending to be a calculated obstacle or source. A full flattened concept image would bake a fixed table, lamp positions, numbers and controls; moving the model would then disagree with the visible room. Replacing Canvas 2D with a 3D engine would add loading, hit-testing and camera complexity without improving the underlying evidence.

### Keep one compact hierarchy

Retain Studio, Desk, Library, Week and Quiet in the application shell. Within Studio, place the current study title and concise brief above the room, use a narrow commission rail, put mode controls close to the stage, display a compact live-reading strip, and keep the selected object's essential controls in an inspector. Advanced geometry, notebook, observations and reports remain reachable through deliberate disclosure and the study record.

At desktop the stage and brief sit together; compact/mobile layouts reorder the same content without clipping actions or text. Use warm serif display type, readable body/control type, thin purposeful rules and opaque-enough text surfaces. The alternative of placing every existing form above the stage would diminish the approved composition and obscure the current action.

### Route workflow actions through existing operations

Arrange focuses the stage/editor; Predict opens or resumes the existing prediction/staged-result UI; Compare opens the current saved-pair selection and numeric table; Choose opens the existing decision form for that pair. The actions derive prerequisites from real study state. They do not advance a progress score or create records when clicked. Committed/staged work remains protected by the existing transaction and validation path.

This retains mature 3.0 behavior while turning visual step labels into useful controls. A decorative progress strip or a new parallel state machine would risk misleading progress and drift from persisted state.

### Derive the difference field from immutable saved scenes

Use `compareAlternatives` and `geometryMatches` to gate two distinct saved identities under a shared surface and stable measurement setup. Sample both retained scenes at the same physical grid locations through `sampleField`, then calculate `D(x,y) = E_B(x,y) − E_A(x,y)` in lx. Keep this sampler pure or expose it through a small pure study helper so analytical cases can be checked independently of rendering.

Render a symmetric diverging scale using `±max(abs(D))`, report the actual signed displayed domain in a nearby legend, and show a neutral finite result when the maximum is zero. A warm tone means B is brighter, a cool tone means B is dimmer; the text legend and unchanged status carry meaning without colour alone. Preserve the per-point numeric table. Identify the pair explicitly and do not apply its field to a subsequently edited working layout. A mismatched pair produces an explanation, not a field. The grid is a sampled visualization; named detector calculations remain authoritative and displayed scale does not imply measurement precision.

Normal Layout/Light field/Paths retain existing semantics. Committed predictions continue to distinguish baseline from proposed geometry; the saved-pair comparison never silently becomes a proposed experiment result. The alternative of subtracting screenshots or RGBA heatmaps would measure display compression rather than lux and is rejected.

### Keep compatibility and verification focused

No persisted study schema changes are required: difference mode is a derived view of existing alternatives. Asset loading is bounded to packaged local files; there is no added network dependency for the room. Retain 3.0 state import/export, launcher and optional services. Test sign, equal-zero, analytic contributions, mismatches and independence from working edits for the new sampler, then run the existing regression suite and an actual saved-study walkthrough.

Save visible day/night evidence at 1366×900, 668×518 and 390×844, including a fresh workspace and a real matched comparison. Inspect keyboard focus, labels, text contrast, scrolling and motion preferences. This visual refinement does not warrant a new exhaustive test framework or copying tests that merely repeat CSS implementation.

## Risks / Trade-offs

- [Artwork competes with controls or hides scientific objects] → Reserve readable control surfaces, draw live geometry above art, and inspect day/night screenshots at all acceptance sizes.
- [Baked illustration suggests unmodelled physical effects] → Keep modeled lamps/screens distinctly interactive and state that artwork/daylight/reflections do not contribute to calculated lux.
- [Responsive cropping distorts the apparent table] → Let the actual table use its own scene transform; crop only the environmental layer and keep numeric dimensions visible.
- [Dynamic colour scaling exaggerates a small contrast] → Label the signed lux range, retain numeric point values, and show neutral unchanged output for zero fields.
- [Workflow navigation loses unfinished evidence] → Reuse existing domain transactions and verify refresh/navigation with a committed prediction and staged conclusion.
- [Image size slows first paint or enlarges release] → Use appropriately sized local assets, inspect encoded dimensions/bytes, and preserve the procedural fallback.

## Migration Plan

1. Preserve the verified 3.0.0 ZIP, manifest and receipt before release replacement.
2. Implement the focused presentation and derived comparison view against the same study/storage model.
3. Verify old state recovery, scientific/regression behavior, exported evidence and visual/keyboard acceptance.
4. Update the product version and current documentation/QA, package one clean 3.1.0 root with original assets, and reconcile archive CRC/member hashes against its manifest and receipt.
5. Roll back by restoring the preserved 3.0 payload; existing workspace evidence remains compatible because the persisted model is unchanged.
