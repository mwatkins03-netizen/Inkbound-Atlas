# Inkbound — The Endless Atlas (cartography rewrite)

A static site: open `index.html` from any web server (GitHub Pages works as-is). No build step.

## What changed in this build

The original prototype drew one fixed continent silhouette with symbols scattered on a grid and a blurry
1024 × 512 globe heightmap stretched over the page. This build replaces the map engine:

- **`atlas-core.js`** — the world model. Seed → warped-noise continent (or archipelago) → mountain spines with
  ridged relief → priority-flood drainage (rivers, lakes, flow accumulation) → climate and biomes →
  settlements scored by harbours and confluences → least-cost roads → generated place names → region labels
  placed at cluster interiors with collision avoidance → terrain-aware symbol placement. Coastlines, contour
  lines, coast rings, lakes and rivers are extracted as vectors (marching squares + Chaikin smoothing).
  Runs in Node too (`node -e 'require("./atlas-core.js").build({seed:1,kind:"kingdom"})'`).
- **`atlas-render.js`** — two renderers over one model. *Traditional ink chart*: parchment washes, coast
  rings, rhumb lines, layered hand-drawn mountains, conifer/broadleaf forests, dunes, marsh, walled cities,
  labels set along arcs, compass rose, cartouche and scale bar. *Topographic atlas*: hypsometric tint,
  hillshade, contours, bathymetric sea, elevation legend. Three palettes (parchment, ivory, midnight).
- **`terrain.js`** — projects the atlas heightmap onto the globe grid so the 3D globe (`globe.js`, unchanged)
  shows the same world.
- **Draw tools** now edit the terrain: land/sea brushes reshape the coast and everything downstream
  (rivers, lakes, regions, towns) is recomputed.

## The globe

`blender/globe_stand.py` builds the c. 1750 table globe headlessly (`Blender -b -P blender/globe_stand.py`):
brass meridian band, hour circle, mahogany horizon ring with a paper calendar band, four turned baluster legs,
cross stretcher and a compass box under glass, with procedural mahogany and oak baked to textures and exported
to `assets/globe-stand.glb`. `globe-world.js` grows a whole sphere around the atlas continent and paints a
4096 × 2048 engraving in the manner of an 18th-century globe: Lehmann hachures, stippled coasts, hand-coloured
outlines, Latin circles and ecliptic with zodiac, rhumb lines, ships, sea monsters, a rocaille cartouche and
Terra Incognita for continents the known world has not reached. `globe.js` stages it in three.js (loaded from
jsDelivr via the import map) with a candle-lit study, and reveals the ink stroke by stroke across the film.

## Buildable assets

- **Export map** → 3200 × 2200 PNG of the current view and palette.
- **Symbol sheet** → the full procedural symbol library as an editable **SVG** (vector paths) and a PNG,
  in the current palette. 12 symbol types × 5 sizes.
- **Save world** → JSON (seed, kind, title, traits, brush edits, stamped symbols, settings). Reopen with
  *Open world*. Version 1 files from the earlier prototype still open.
- **Blender stand** → `assets/globe-stand.glb` plus the baked `mahogany-grain.png` / `tableoak-grain.png`; rebuild or restyle from the Python script.
- **Record reveal / Record globe** → WebM video of the 2D ink reveal or the 3D globe flight.

## Credits

Range shaping adapts Azgaar's Fantasy Map Generator (MIT, `licenses/azgaar-MIT.txt`). Hillshade and
hypsometric practice informed by Eleanor Lutz's Atlas of Space. Fonts: Cormorant Garamond and DM Sans via
Google Fonts. Soundtrack credits are in the page footer.

AI disclosure: this cartography rewrite was produced with Claude (Anthropic) from the earlier Inkbound
prototype, directed and reviewed by Marc Watkins.


## Read tab · a passage becomes a map (Jev)

Paste a page of prose and choose **Read with Jev, then draw**. Jev, TypeSafe AI's System One judgment model, answers eight fixed questions about the place in the text and returns a probability for each: land shape (mainland, islands, desert, frozen), coast, mountains, forest, river, settlement level (five rungs), mood (bleak, serene, menacing, prosperous), and whether a rift or gorge is present. The confident answers become the world: shape sets the generator kind, mountains set geological character, settlement sets detail, forest and river bias moisture and drainage, mood picks the ink and paper. The seed is a hash of the passage, so the same page always draws the same map.

Where the text is silent or the model is unsure, the map fogs at the margins and a Terra Incognita cartouche lists what the passage did not say. Five public-domain passages are built in (Melville, Hardy, Brontë, Stevenson, London). The reading is stored in saved world files. Jev never writes anything; every number shown is one the model returned.

The page posts to a proxy that holds the API key and stores nothing (default: the University of Mississippi Worker from the Jev Sandbox). Use **Jev connection** under the passage to point at your own proxy. Files: `jev-reader.js`, small hooks in `app.js` and `atlas-core.js` (new traits `wet`, `dry`, `rivers`, `dryland`).
