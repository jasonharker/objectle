# Every model is rendered through one stylized normalization shader

The 700-noun Guess Vocabulary is sourced from mixed libraries (CC0/CC-BY scans, stylized low-poly sets, image-to-3D generation), and mixed art styles both look incoherent and leak information ("the scanned-looking ones are food"). Rather than accept only realistic PBR models — which would shrink usable supply and raise per-noun processing well beyond budget — we render every model through a single shader: soft toon shading, base color quantized to a shared palette at 8–16 levels per hue, one fixed lighting rig, and source-baked lighting discarded. The game's look is this shader, not the source assets.

## Considered Options

- **Curated realism** — rejected: too few qualifying models for 700 nouns within budget.
- **Generate every model with one image-to-3D model** — rejected: uneven on thin or complex objects; ties the whole look to one model's license and quirks.
- **Uniform low-poly remesh** — rejected: destroys the surface detail Reveal Stages 1 and 3 depend on.

## Consequences

- Fine surface detail (wood grain, fabric weave) is partly lost, making Reveal Stage 1 harder; the palette depth is the tuning knob.
- The stage-authoring tool must render through the same shader so the curator sees exactly what players see.
- Swapping to realism later means re-vetting the whole Guess Vocabulary.
