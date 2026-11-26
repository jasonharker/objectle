# Reveal Stages 1–5 are pre-rendered images; only stage 6 ships geometry

A Reveal Stage's assets must disclose nothing a later stage discloses (ADR-0001). Stages 1–5 each have one fixed Stage Camera, so none of them needs a 3D view; only stage 6's free orbit does. We decided each of stages 1–5 ships as one image, rendered from its Stage Camera through the normalization shader (ADR-0002) by the curation build, and stage 6 ships the model. An image carries only the pixels its camera saw — no back faces, nothing outside the frame, no depth, no texture beyond what is visible — so it cannot be mined for a later stage.

## The stages

| Stage | Kind | Asset | Why it cannot be used to recover a later stage |
|---|---|---|---|
| 1 | surface | Image: a tight crop of the shaded, textured render, framed wholly inside the object's outline | No background pixel, so no outline (stage 2); only the framed patch of texture, not the rest (3, 5); no geometry (6) |
| 2 | shape | Image: silhouette, one flat colour, no shading or interior detail | No shading, so no form (4); no colour or texture (3, 5); one view's outline, not the others (6) |
| 3 | surface | Image: a wider textured crop; background and part of the outline may show | Only the framed region's texture and form, not the whole object (4, 5); no geometry (6) |
| 4 | shape | Image: clay — the whole object shaded in one neutral colour, normal and bump maps dropped | No colour, texture or relief (5); one view, no back faces (6) |
| 5 | surface | Image: the whole object shaded and textured | One view, no back faces or hidden parts (6) |
| 6 | — | A stage-only export of the model, with free orbit, plus the first letter | Last stage: only the name remains, and the export carries neither the name nor the Ghost model's bytes |

Every image is lossless WebP at 1024×1024, so its size says nothing about the object; it has alpha where background shows, so the client supplies the backdrop, and no metadata. Lossless because the shader's quantized palette compresses well and lossy artefacts would blur the palette steps stage 1 depends on. The resolution caps the texture detail stage 1 can show, so it is a build setting alongside palette depth and black floor.

The stage-1 rule is the one that needs enforcing: the curation build refuses a stage-1 Stage Camera that frames any background pixel, and the stage-authoring tool warns live, because an edge in a stage-1 crop discloses shape ahead of stage 2.

## Considered Options

- **Stripped or cropped geometry per stage, rendered in the client** — rejected: a cropped mesh still carries depth, UVs and the whole texture unless each is re-cut per stage, which is easy to get wrong five times per object, and a fixed camera gains nothing from geometry.

## Consequences

- Stage 6 is not the noun's Guess Vocabulary model file. That file is also its Ghost, and every Ghost is revealed with its name whenever anyone guesses that noun, so serving the same bytes would let players solve stage 6 by matching the file against Ghosts they have collected. Stage 6 is a separate export of the same geometry and textures, re-encoded so its bytes match no Ghost, with node, mesh, material and texture names, `extras` and generator metadata stripped.
- Comparing the stage-6 mesh vertex by vertex against collected Ghost models still identifies it. Accepted: stage 6 already shows the whole model and the first letter, and defeating mesh matching would mean a perturbed model that differs from its own Ghost.
- Beside the Ghosts, the hidden Daily Object is a plain ball whose longest dimension is its Size through stage 5, since no geometry ships before stage 6; from stage 6, and at the game's end, the stage-6 export takes its place.
- A stage asset's id is a keyed hash of the Puzzle Number and its bytes, not of its bytes alone, so when an Answer Pool object recurs its assets get new URLs and an archive of past URLs, paired with names at each game's end, cannot identify it. The bytes are unchanged, so a script that hashes or perceptually matches a downloaded asset against archived ones can still recognise a repeat; accepted, and spacing repeats out is the Schedule policy's job.
- Stage assets are curation-build output, not rendered live: the API has no GPU to render with. The curator authors only the Stage Cameras; the curation build renders stages 1–5 and exports stage 6 in a headless browser, through the same render code the stage-authoring tool previews with. Retuning palette depth or the black floor (ADR-0002) is one build run, not re-authoring every Answer Pool object, and the assets are always reproducible from the content repo.
- The build needs headless Chromium with WebGL (software rendering suffices), which makes the content image's pipeline heavier.
