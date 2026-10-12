# Original artwork and source references

The room and material bitmap assets were created with the built-in imagegen tool on 2026-10-12, using the user-approved Afterlight day/night concept images as style references. The reading book was generated separately with a transparent background. They are decorative room/material/paper assets, not pre-rendered UI, calculated fields, real readings or licensed photographs. The actual lamps, screens, points, labels, fields and numbers are drawn live.

## room-night.png

- Output: assets/room-night.png
- Generated source filename: exec-bfa9a6b3-fdfa-4eee-98dc-3dc8c68ec669.png
- Size: 1774 × 887 px
- Role: Night room environment; rug centre empty for live geometry.

## room-day.png

- Output: assets/room-day.png
- Generated source filename: exec-16aa8f90-7993-4e5f-9d83-8ec4fc240805.png
- Size: 1774 × 887 px
- Role: Day room environment; incidental room light is outside the model.

## table-oak.png

- Output: assets/table-oak.png
- Generated source filename: exec-257a2758-83f7-42cc-a02c-80064cfd75bd.png
- Size: 1774 × 887 px
- Role: Neutral oak surface texture, clipped to actual study dimensions.

## Prompt directions (summaries)

The local table refinement adds `assets/table-oak-refined.png` (1774 × 887 px, source `exec-9640eac3-475f-496e-9860-c9d08fe4f08e.png`) with quieter diffuse honey-oak grain. It contains no lamps, light pools or objects. The previous oak is preserved.

It also adds `assets/reading-book.png` (1536 × 1024 px, source `exec-46f479a1-84fa-4b8c-a9ea-574d56680b84.png`), an overhead open book with original RGBA transparency retained. Its faint marks are decorative, not source quotations or evidence. Live illumination is applied over both the paper and wood. A notebook and pencil are drawn in code. Only configured opaque screens participate in the blocking model.

Exact submitted prompts and generation mode for these two local assets are recorded in [table-material-prompts.md](docs/table-material-prompts.md).

The following local interaction refinement adds `assets/lamp-brass.png` (1254 × 1254 px, source `exec-68efa41a-2ed3-4757-8ea1-c43966830b2f.png`), generated with built-in imagegen and original RGBA transparency retained. It is a neutral antique brass shade cutout with no emitted beam, pool, halo or reading. Its exact prompt is in the same prompt record. The application draws the support, physical anchor, bulb emission and selection live; inactive sources retain a muted material body without contributing light. The table book and notebook navigate to the actual Field guide and study record without creating data.

Night room: Richly detailed orthographic overhead literary library, ink-teal/aged brass/wood/stone/Persian rug, wicker chairs and peripheral books, ivy and sleeping cat. Very wide2:1. Completely empty central rug for the live2:1 table; four chairs outside it. Night atmosphere, no central lamp beams. No table, lamps, text, numbers, controls, panels or UI.

Day room: Same overhead literary material direction in ivory stone, honey oak, brass and sunlit room margins. Completely empty central rug with chairs outside; centre softly and evenly lit. No table, lamps, central light hotspots, text, labels, controls or UI.

Oak: Wide2:1 macro aged honey-brown oak, fine horizontal grain, knots, scratches and patina. Edge-to-edge orthographic material, moderate contrast and diffuse even light. No room, furniture edges, objects, lamps, light spots, text or UI.

## Application sources

Application code and artwork are original. PDF.js is the npm dependency declared in package.json and package-lock.json. Get It, Ray Optics, LOOPY and PhET were inspected as source/interaction comparisons; no application code or assets were copied. The selected OpenSpec research and current QA identify observations, design choices and verification limits. REA was used for a fresh static inventory of the preserved3.0 release, not for claiming live behavior.
