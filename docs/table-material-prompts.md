# Table refinement asset prompts

## Live brass shade (inviting-table refinement)

- Runtime asset: `assets/lamp-brass.png`
- Generated source: `exec-68efa41a-2ed3-4757-8ea1-c43966830b2f.png`
- Built-in imagegen, transparent_background=true, 1254 × 1254 RGBA. Original alpha retained; corner alpha is zero.
- The sprite supplies neutral material detail only. The support, physical anchor, source emission, selection and hit regions are drawn live.

Use case: product-mockup
Asset type: transparent furniture fixture sprite for the LIVE interactive Afterlight reading table.
Input image: the approved night concept is a material reference for its antique brass reading fixtures ONLY, not a screenshot to reproduce.
Primary request: one perfectly overhead, orthographic, round antique brass reading-lamp shade, isolated on a genuinely transparent background. Show a believable shallow domed shade with a gracefully flared narrow rim, small central brass finial and concentric crafted metal detail. Rich tobacco/aged-gold patina, burnished highlights, subtle brushed metal. It should look like a small actual library furnishing seen from above, not a flat icon or a jewel.
Composition: single circular shade centered, whole silhouette fully visible and occupying about 88% of a square image. No cables, stems or other detached objects; those are drawn live. No cast shadow beyond the silhouette.
Lighting: completely neutral diffuse studio light, no emitted light, no lit bulb, no baked light pools, halo, beam or glow. Tiny material self-shading and reflections only. Our renderer controls lamp emission.
Constraints: transparent background with clean alpha; no room, wood, table, labels, measurements, numbers, symbols, UI, text or watermark. One single fixture cutout only.

Generated locally on 2026-10-12 with the built-in imagegen tool. This records the exact submitted prompts; it does not describe a simulated UI screenshot.

## Calmer oak

- Runtime asset: `assets/table-oak-refined.png`
- Generated source: `exec-9640eac3-475f-496e-9860-c9d08fe4f08e.png`
- References: the original Afterlight night and day concept images.
- The original `assets/table-oak.png` remains available.

Use case: style-transfer
Asset type: neutral wood material for the LIVE interactive tabletop of Afterlight.
Input images: Image 1 is the approved night UI concept; Image 2 is its approved day version. Match ONLY their table's refined antique wood material and photographic painterly finish.
Primary request: Generate one wide horizontal 2:1 edge-to-edge orthographic material image of a beautifully crafted aged honey-oak reading table surface, with softly burnished patina, quiet fine horizontal grain, restrained very subtle plank character and small authentic wear. This is a reusable surface texture, not an image of an entire table or interface.
Composition: continuous timber material fills the entire image, no visible furniture silhouette or outer edge, no perspective. The centre must be calm enough for live reading markers and moving light pools. Avoid large dark knots, heavy cracks, scratched scanline grain or noisy high-frequency detail.
Lighting: completely even, neutral diffuse illumination across the full image. No baked-in light pools, beams, directional shadows, vignette or glare; our physics renderer adds the illumination.
Palette: warm muted honey and tobacco oak, rich tonal detail, medium-low contrast. Natural furniture finish, not bright orange flooring or raw rustic planks.
Constraints: NO objects, plants, books, cups, lamps, chairs, room, text, symbols, measurements, labels, borders or UI. Do not reproduce the reference interface. One standalone material texture only.

## Reading book

- Runtime asset: `assets/reading-book.png`
- Generated source: `exec-46f479a1-84fa-4b8c-a9ea-574d56680b84.png`
- Mode: built-in imagegen, transparent_background=true. RGBA PNG; corner alpha is zero. Original alpha retained.

Use case: product-mockup
Asset type: transparent cutout reading prop for an interactive overhead table.
Primary request: One beautiful small antique open reading book, viewed perfectly from directly above, lying flat. Two warm ivory pages, thin aged tobacco-brown leather cover, delicate authentic page-edge layers and a restrained pencil botanical study on one page with a few faint unrecognizable ink lines on the other. A slim muted forest-green ribbon bookmark comes out of the lower spine.
Style: Rich photographic painterly material detail, like the approved Afterlight reference's reading objects. Refined and tactile, not cartoon line art.
Lighting: even neutral diffuse light. No lamp light, no baked beams or large shadows. Tiny object-edge self shading only; our live renderer adds room illumination.
Composition: the whole open book centered, fully visible with a small transparent margin; orthographic top-down, no perspective or surrounding scene. No other objects.
Constraints: genuinely transparent background. No wood, table, plants outside the page drawing, hands, text captions, readable invented quotations, UI, numbers, measurements or watermarks. Only one open book cutout.
