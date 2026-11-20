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
