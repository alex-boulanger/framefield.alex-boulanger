Status: pass 1 shipped — image placement and text deferred

# Unified Layer Stack v2

## Where this stands

Scope was cut into three passes after review. **Pass 1 (the model) is done**: the
stack is unified, v1 recipes migrate, and all 10 presets render byte-identical
to before the change — that parity was captured as hashes before any code moved
and re-checked after, so "the migration preserved existing artwork" is a
measured fact rather than an intention.

Deferred, in order:

- **Pass 2 — image placement.** The param model (`fit`/`x`/`y`/`scale`), the
  renderer support, and the multi-asset registry all landed; only the dedicated
  move/scale UI is missing, and the generic inspector already renders the
  controls from the spec list.
- **Pass 3 — text layers.** Not started. See the risks recorded below before
  starting: the font/worker problem is the whole cost of that feature.

Decisions taken during pass 1 that change what is written further down:

- **The accumulator is opaque, not transparent** (contradicts story 47). Every
  effect transforms RGB and ignores alpha, so a transparent ground has them
  quantizing and blurring pixels that are not there. The recipe carries a
  `background` colour instead. Source layers still composite by their own alpha,
  so nothing about blending is lost; transparent PNG export is (story 48 keeps
  today's behaviour).
- **Source and effect layers composite by different laws.** They share every
  control, but an effect's output covers exactly what its input covered while a
  source layer's coverage is per-pixel. Treating them alike replaces the
  accumulator with holes instead of compositing into it.
- **Preview caching had to be redesigned, not preserved.** The old source cache
  has no meaning without a source. It was replaced by a checkpoint at the
  deepest unchanged layer, which is strictly better: editing the top of a stack
  now skips the generators *and* the effects below it (6–20x on the presets).
- **Palette propagation flows generator → effects only**, never generator →
  generator. A second field is a compositional choice with its own colourway.
- **Per-layer palettes for generators are in; a recipe-level colourway is not.**
- **Randomize-source became per-layer.** `SourcePanel` is deleted; a generator
  layer randomizes from its own inspector, and Remix still does the whole stack.
- Image placement is expressed as a **fit baseline plus offset**, not absolute
  coordinates, so a v1 cover-fit migrates losslessly without needing the
  bitmap's dimensions — which sanitization does not have and may never get.

Known open risks for pass 3, recorded while they were fresh:

- A worker does not inherit the document's `@font-face`, `self.fonts` support is
  uneven, and the renderer is synchronous — an unloaded font falls back
  silently, which is exactly the preview/export mismatch story 34 forbids.
- Tests run in node with no canvas, so a text layer renders nothing there. The
  planned renderer test for "text treated by a later effect" cannot pass as
  written without a canvas-free fallback (`glyphAtlas.ts` already needed one).
- The escape hatch worth trying first: rasterize text on the main thread and
  hand it to the worker as an asset, like an imported image.

## Problem Statement

Framefield is still organized like an MVP renderer: a recipe has exactly one source, either procedural or imported image, followed by a stack of FX layers. That split is limiting the product. The user wants to create artwork and generative art by composing generators, images, typography, and effects in one ordered stack.

The current model makes common artwork workflows awkward or impossible:

- a generator cannot be blended with another generator
- an imported image cannot sit between FX layers
- text cannot be treated as artwork and then processed by the same FX stack
- image placement is implicit cover-fit rather than an editable art direction choice
- the layer stack UI only represents post-source effects, not the actual composition

To feel like a real personal generative art tool rather than an MVP, Framefield needs a document model where sources and effects are peers in the same stack.

## Solution

Introduce `Recipe v2` with a single linear layer stack. The stack can mix generator layers, image layers, text layers, and effect layers. Rendering walks the stack from bottom to top over a transparent canvas-sized accumulator.

Source-producing layers render their own pixels and composite into the accumulator using the same layer controls as the existing FX stack: enabled state, name, opacity, blend mode, and tone mask where applicable. Effect layers behave like adjustment layers: they affect the accumulated pixels below them, then composite the result back according to their opacity, blend mode, and mask.

The user-facing result is one stack that describes the whole artwork:

- procedural field layer
- image layer with editable move/scale placement
- poster typography layer
- posterize adjustment layer
- dither adjustment layer
- grain adjustment layer

Remove-background is intentionally excluded from v2. The v2 image tool scope is placement and scaling, not subject segmentation.

## User Stories

1. As an artist, I want generator, image, text, and FX layers in one stack, so that the stack represents the full artwork.
2. As an artist, I want to place an FX above several source layers, so that it processes the combined composition.
3. As an artist, I want to place an FX between source layers, so that only lower layers are processed before upper layers are added.
4. As an artist, I want generator layers to have opacity and blend mode, so that I can mix procedural sources.
5. As an artist, I want image layers to have opacity and blend mode, so that imported images can become compositional material.
6. As an artist, I want text layers to have opacity and blend mode, so that typography can be part of the visual stack.
7. As an artist, I want effect layers to keep their existing controls, so that the current FX workflow still works.
8. As an artist, I want a default recipe that opens as a complete v2 stack, so that first launch still produces an interesting image.
9. As an artist, I want old recipes to continue opening, so that local snapshots and shared URLs are not broken.
10. As an artist, I want an old generator source plus FX stack to migrate into equivalent v2 layers, so that current artwork looks the same after the migration.
11. As an artist, I want an old image source plus FX stack to migrate into equivalent v2 layers, so that imported-image recipes keep their behavior.
12. As an artist, I want to add a generator layer from the same add-layer flow as FXs, so that I do not have to think in separate source and effect panels.
13. As an artist, I want to add an image layer, so that imported photos or textures can be composed anywhere in the stack.
14. As an artist, I want to add a text layer, so that poster typography can be created inside Framefield.
15. As an artist, I want to reorder any layer type by drag and drop, so that I can explore stack order quickly.
16. As an artist, I want to rename any layer type, so that a complex artwork stays readable.
17. As an artist, I want to duplicate any layer type, so that I can build variations without rebuilding parameters.
18. As an artist, I want to disable any layer type, so that I can compare compositions quickly.
19. As an artist, I want to delete any layer type, so that cleanup is consistent across the stack.
20. As an artist, I want source layer controls to appear in the inspector, so that editing a layer feels consistent.
21. As an artist, I want a generator layer to expose the current field controls, so that existing procedural controls are preserved.
22. As an artist, I want generator layers to have their own seed, so that each procedural layer can be varied independently.
23. As an artist, I want generator layers to have their own palette, so that layered generators can intentionally differ.
24. As an artist, I want palette propagation to remain predictable, so that FX palettes do not unexpectedly diverge when a generator palette changes.
25. As an artist, I want an image layer to expose move controls, so that I can position the imported image in the canvas.
26. As an artist, I want an image layer to expose scale controls, so that I can crop or reveal more of the image.
27. As an artist, I want image placement to be deterministic across preview and export, so that the exported PNG matches what I tuned.
28. As an artist, I want image placement to use export-space units, so that resizing preview fidelity does not change the composition.
29. As an artist, I want text layers to support poster-style typography, so that I can create artwork with words, not just captions.
30. As an artist, I want text layers to support multiline text, so that poster layouts are practical.
31. As an artist, I want text layers to support arty font choices, so that typography has visual character.
32. As an artist, I want text layers to expose font size, line height, tracking, alignment, and fill color, so that basic poster composition is possible.
33. As an artist, I want text layers to render before FX layers above them, so that text can be posterized, dithered, pixelated, or distorted.
34. As an artist, I want text rendering to match between preview and export, so that exported typography is not a surprise.
35. As an artist, I want the export panel to keep working with v2 recipes, so that the new stack does not break PNG export.
36. As an artist, I want the render worker to support v2 recipes, so that previews remain responsive.
37. As an artist, I want undo and redo to cover all v2 layer edits, so that experimenting remains safe.
38. As an artist, I want local snapshots to store v2 recipes, so that I can save personal presets with mixed source layers.
39. As an artist, I want old local snapshots to load after v2 lands, so that previous work remains usable.
40. As an artist, I want randomize-all to create a coherent v2 stack, so that exploration uses the new composition model.
41. As an artist, I want randomize-FX to randomize only effect layers, so that source/image/text composition is not destroyed.
42. As an artist, I want randomize-source behavior to be redefined for v2, so that it is clear which source layer changes.
43. As an artist, I want the selected layer inspector to adapt to the selected layer kind, so that controls stay focused.
44. As an artist, I want missing imported image layers to show a useful missing-source state, so that recipes remain inspectable without embedded bitmap data.
45. As an artist, I want shared recipes to remain serializable, so that the document model stays portable.
46. As an artist, I want imported image pixels to remain outside recipe JSON, so that recipes stay small and safe.
47. As an artist, I want the canvas to start transparent internally, so that source layer blending is meaningful.
48. As an artist, I want the final export to preserve the existing PNG behavior, so that the rendered artwork downloads normally.
49. As an artist, I want effect layers at the bottom of the stack to behave predictably, so that accidental stack states do not crash rendering.
50. As an artist, I want the UI vocabulary to say "layers" rather than "source plus FX stack", so that the product model is clear.

## Implementation Decisions

- The document model becomes `Recipe v2`.
- `Recipe v2` has one ordered `layers` array. There is no separate `source` field.
- Layers have a discriminated kind:
  - generator layer
  - image layer
  - text layer
  - effect layer
- All layer kinds share core layer metadata:
  - stable id
  - optional name
  - enabled state
  - opacity
  - blend mode
  - params
- Tone masks remain available for effect layers. Whether masks apply to source layers should be conservative: keep them effect-only unless implementation reveals a low-cost, clear UI for source masks.
- The stack remains linear. Node graphs, branches, nested groups, and arbitrary routing are not part of this version.
- Effect layers are adjustment layers. They apply to the accumulated pixels below them, not only to the immediately previous source layer.
- Source layers render pixels into a same-sized layer buffer, then composite that layer buffer into the accumulator.
- The internal accumulator starts transparent at canvas size.
- If an effect layer appears before any visible source pixels, it processes the transparent accumulator and should not crash.
- Generator layers initially support the existing procedural field generator.
- Generator layer params include seed and the existing field generator params.
- Image layers reference external imported image data by local runtime handle/name, not embedded bitmap data.
- Image layer params include at least x, y, and scale in export-space units.
- Image layers should use deterministic sampling and placement so preview and export match.
- Image layers should replace the current implicit cover-fit source behavior with explicit editable placement. Migration can encode the old cover-fit placement as initial image layer params.
- Text layers are poster typography layers, not full document-layout text boxes.
- Text layer params include text content, font family, font size, line height, tracking, alignment, position, and fill color.
- Text layers should render into pixels before later FX layers run.
- Arty fonts should be local bundled assets or system-safe choices that can render in both the main thread and worker. External font fetching is not required.
- Remove-background is explicitly excluded from v2. Do not add AI segmentation, third-party removebg APIs, or model downloads in this spec.
- Existing FX definitions should stay reusable. The renderer should adapt layer orchestration, not rewrite every effect.
- The render worker must accept v2 recipes for preview and export.
- Undo/redo stores whole v2 recipes, as it currently does for v1 recipes.
- Local snapshots store v2 recipes in localStorage.
- Recipe sanitization must accept v1 recipes and migrate them to v2 on load.
- Recipe sanitization must reject or normalize malformed v2 layers.
- Old generator-source recipes migrate to a generator layer followed by migrated effect layers.
- Old image-source recipes migrate to an image layer followed by migrated effect layers.
- Existing effect layers migrate to effect-kind layers with the same effect type and params.
- Current randomization behaviors need v2 semantics:
  - randomize-all/remix may create or replace a coherent full stack
  - randomize-FX changes only effect layers
  - randomize-source should target the selected source layer or the first generator layer; if unclear, prefer a later UX decision before implementation
- The UI should present a single stack, not separate source and FX stack concepts.
- The add-layer UI should group layer kinds by source and effect without creating separate stacks.
- The inspector should switch controls based on layer kind.
- The selected-layer model should work for all layer kinds.
- Export dimensions and preview scaling remain recipe-level canvas concerns.

## Testing Decisions

- The highest-value test seam is the recipe renderer boundary: given a serialized recipe and optional decoded image assets, rendering should produce predictable pixels.
- Tests should assert external behavior, not implementation details. Good tests prove stack semantics, migration behavior, and preview/export parity without asserting React component internals.
- Renderer tests should cover:
  - generator layer followed by effect layer
  - two source layers blended together
  - effect layer between two source layers only affecting lower accumulated pixels
  - text layer affected by a later effect layer
  - disabled layers skipped consistently
  - opacity and blend mode applied consistently to source and effect layers
  - effect-at-bottom does not crash
- Migration tests should cover:
  - v1 generator source plus FX stack migrates to equivalent v2 stack
  - v1 image source plus FX stack migrates to equivalent v2 stack
  - malformed v2 layers are sanitized without crashing
  - old local snapshot payloads continue to load through recipe sanitization
- Store tests should cover:
  - adding each layer kind
  - selecting each layer kind
  - moving mixed layer kinds
  - duplicating mixed layer kinds
  - undo/redo across source, text, image, and effect edits
  - randomize-FX preserving non-effect layers
- Worker tests should stay indirect where possible: render and export behavior should be shared by main-thread and worker paths through the same renderer functions.
- UI behavior should be tested only where renderer/store tests cannot cover it:
  - the inspector shows controls for the selected layer kind
  - the add-layer flow can create generator, image, text, and effect layers
- Prior art exists in the current renderer tests for stack ordering, scale fidelity, source rendering, recipe sanitization, and store history. Extend those patterns rather than introducing a new test style.
- The ideal long-term seam is one renderer test suite for v2 stack behavior plus targeted store tests for editing actions.

## Out of Scope

- Remove background.
- AI subject segmentation.
- Third-party image APIs.
- Cloud sync.
- Auth.
- Sharing/collaboration.
- Node graph rendering.
- Layer groups.
- Masks beyond the existing tone-mask concept.
- Full text layout, rich text editing, inline spans, paragraph styles, or text-on-path.
- Vector export.
- Animation or timeline.
- Non-field procedural generators, unless added separately after the v2 model exists.
- Destructive editing of imported image pixels.

## Further Notes

- This is a structural product upgrade. It should be implemented as a document-model migration before expanding the UI heavily.
- The current renderer already uses RGBA float buffers, which supports a transparent accumulator and source compositing model.
- The main risk is trying to ship every visible product affordance at the same time as the recipe migration. Keep the first implementation narrow: migrate the model, preserve current visual output, then add image placement and text layers.
- The likely implementation order is:
  - introduce v2 types and migration
  - adapt renderer to unified stack
  - preserve existing default/remix/randomize behavior
  - adapt store and layer UI to mixed layer kinds
  - add image move/scale controls
  - add poster text layer
  - polish local snapshots and export parity
