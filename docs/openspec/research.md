> Planning and source-research record. Use the delivery README and qa/CURRENT-REPORT.md for implemented behaviour and current verification.

# Evidence for one stronger Afterlight

Read-only investigation on 2026-10-11. Source repositories and existing local output were inspected; no third-party application was installed or integrated. This was a pre-implementation audit of version 2.1.0; the delivery README and qa/CURRENT-REPORT.md identify the current release.

## Local findings

- The Conservatory's desktop welcome/channel screenshots show a drawn place, named chapters, an integrated metric strip and a clear experiment goal. These are the visual strengths to recover, not a reason to ship two applications.
- Afterlight's current desktop Lab screenshot shows a mostly empty field beside a long parameter form, with five equally weighted destinations. Its scientific records are stronger than the earlier fictional model; its progression and practical output are weaker.
- app.js's transferExperiment copies evidence into a generic draft/action in the active project. It does not retain a chosen lighting arrangement or concrete decision.
- state.lab is global, whereas legacy notes and plans belong to projects. Ownership must become explicit before adding more personal studies.
- After Run, the pending prediction is cleared but the unfinished result/conclusion live in the UI closure. Recovery is part of dependable study work.
- The existing test suite passed 64/64 during this audit. That validates the baseline only.
- The current ZIP already has one afterlight/ root. It also includes a large historical Conservatory REA payload and older captures/reports. The next final package needs an explicit inclusion policy and one current QA entry point.

## Primary references

| Reference | Mechanism worth adapting | Boundary |
| --- | --- | --- |
| [Ray Optics](https://github.com/ricktu288/ray-optics) | Editable optical scenes, detector data, restorable scene files and quantitative export. [Detector CSV](https://github.com/ricktu288/ray-optics/blob/daf76772c73a85e1a2568c4e2e71613bba1fab77/src/core/sceneObjs/other/Detector.js#L137); [scene serialization](https://github.com/ricktu288/ray-optics/blob/daf76772c73a85e1a2568c4e2e71613bba1fab77/src/core/Scene.js#L162). | Apache-2.0 repository. Its ray detector quantities are not the horizontal-plane lux readings used by Afterlight. This design adapts interaction principles and requires no copied code. |
| [PhET Geometric Optics](https://phet.colorado.edu/en/simulations/geometric-optics) | Controlled discovery and visible simplified rules. [Model documentation](https://github.com/phetsims/geometric-optics/blob/main/doc/model.md). | Live public [repository](https://github.com/phetsims/geometric-optics) says outdated/unmaintained and its successor monorepo is unavailable. Treat deployed UX as a reference, not an assumed maintained dependency. The same warning appears in [Bending Light](https://github.com/phetsims/bending-light). |
| [LOOPY](https://github.com/ncase/loopy) | Save/remix a model while retaining its origin, so users can branch and discuss alternatives. [Remix controls](https://github.com/ncase/loopy/blob/2d8e13f0a006f4024f27ad1712d7f9c2c1ad7cd9/v1.1/js/PlayControls.js#L70). | CC0 project with separately listed dependencies. Qualitative causal simulation is different from photometry. |
| [Get It](https://github.com/beltromatti/get-it) | Preserve the selected source/concept when moving to explanation, practice or discussion. | Afterlight retains literal source anchors; model-generated mastery values are not validated learning assessment. |

The [Midnight Academy brief](https://ai.bnbuacm.xyz/#midnight-academy) invites knowledge made into observable, manipulable rules. A fictional studio gives those rules a place; a personal study gives learning a usable outcome.

## Concept data checked against the current evaluator

The excluded concept sketches showed an explicitly labelled example study. The following calculation is design-reference evidence, not a live screenshot. The surface is 2.4×1.2 m. Points A=(0.8,0.6), B=(1.6,0.6). Option A has one 60 cd lamp at (0.8,0.6), height 0.5 m. Option B has two 40 cd lamps directly above A and B, height 0.5 m. No screens are enabled.

The formula is E=Ih/(dx²+dy²+h²)^(3/2). Option A calculates 240 lx at A and 35.730265618191915 lx at B. Option B calculates 183.82017707879461 lx at both. Rounded labels are 240.0, 35.7 and 183.8 lx. The 150–200 lx range is an example user target; the 100% uniformity concerns these two points only. Neither image depicts an actual field measurement or tested live UI.

## Why REA is not needed for this comparison

The repositories expose complete source, so their behaviour and model boundaries can be examined directly. REA is reserved for an unanswered shipped-package/runtime question. Historical REA evidence about the prior Conservatory remains historical; it does not validate the proposed studio or the current release.
