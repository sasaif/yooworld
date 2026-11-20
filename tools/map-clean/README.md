# Clean (text-free) player-map art

`public/playermap/map_clean.webp` is the original illustration (`public/playermap/map.webp`, source
`alessandro_map_v1.png`, 1672×941) with every baked label, the title, the X and the +/- buttons removed, so that all
text, markers, statuses and controls live in the UI layer (`src/ui/map/PlayerMap.tsx`). The original files are kept
unchanged and `map.webp` is the runtime fallback (`onError`, or `?mapart=baked`).

- `mask.py`: the 28 hand-measured label/button boxes (full-res px).
- `inpaint.py`: per-box LaMa inpainting (open-source model, no external or paid art), plus the small café-wall writing.
- `public/playermap/thumbs_clean/*.jpg`: 296×196 card thumbnails cropped from the clean art (the old `thumbs/` keep their baked labels and are kept).

Known weak spots (soft / smeared texture where large labels covered buildings): the Place centrale strip and the Games
Club roof line, the roof tops between the Résidentiel buildings, the sky band under the former title, and to a lesser
degree Festivals, Dépôt and Ponton. District badges and level-2 pins are drawn over most of these spots.

## v2 touch-up (inpaint_v2.py + areas_v2.py) and HD tiles (upscale.py)

`python tools/map-clean/inpaint_v2.py` is driven by `areas_v2.AREAS`. Each area starts again from the original labelled art:
- **Games Club**: the label was the building's own roof sign, so the blue sign and the dice are kept. Only the lettering is erased, using the plate's own colour profile, and five arcade stars are added.
- **Café Yoo**: LaMa rebuilds the background and the left wing roof. The main block gets a hand-drawn shingle hip roof in the wing's colours, plus a text-free cream board with a coffee cup.
- **Festivals**: LaMa repaves the plaza, with all bunting masked out of its context, then removes two phantom posts. The garland is redrawn as one sagging string of triangle flags between the two lamps.
- **Dépôt**: the left block gets a perspective clone of the neighbouring grey roof, with the same white trim.
- **Disco / Karaoké**: a flat purple roof with a neon-pink parapet and two small spotlights. The scraps behind it are covered with a path clone.
- **Place centrale**: plaza paving is cloned from just below, skipping the fountain jet, and its tip is redrawn. LaMa rebuilds only the grass edge and the bench tops.
- **Title sky + Résidentiel**: the untouched top-right of the same art (sky, clouds, snowy mountains, forest) is mirrored at 1:1. A thin LaMa band hides the seam, and the original roof tops are restored.
- **Ponton**: a narrow second LaMa pass removes ghost shapes.

`public/playermap/hd/map_clean_{r}{c}.webp` holds 2×2 tiles of a 3344×1882 version of the clean art. It was made with Real-ESRGAN x4plus-anime-6B (BSD-3, CPU) and then Lanczos-downscaled to exactly 2×. `PlayerMap` loads only the tiles under the view, and only on level 2 when zoom × devicePixelRatio > 1.15 (for example on an iPhone at DPR 3).
