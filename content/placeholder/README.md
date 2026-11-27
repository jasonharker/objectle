# Placeholder content bundle

What the deployed walking skeleton serves until the curation build ships the
real content bundle from the private content repo (ADR-0004). It is the test
fixture's vocabulary and Reveal Stages, with a Schedule that alternates them
for Puzzle Numbers 1-365. Each noun's model, drawn as its Ghost, is a plain box
whose longest dimension is its Size. Its Launch Date, 2026-11-25, is the one
the deployment is configured with; the API refuses to start on a bundle built
for another (ADR-0008).

The two Answer Pool objects' six Reveal Stages are in the ADR-0006 format,
drawn once from their boxes rather than rendered by the curation build:
stages 1-5 are 1024×1024 lossless WebP images (a crop inside one face, the
silhouette, a wider crop, clay, the whole box) using the normalization
shader's lighting rig and palette rule, and stage 6 is the box re-encoded so
its bytes match no Ghost, carrying the stage-5 Stage Camera as its glTF camera.
Nothing here is real curation.
