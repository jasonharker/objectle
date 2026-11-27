# TypeScript throughout, hosted on THALES, content kept in a private repo

Objectle needs a stack for four modules (scoring API, curation build, client, stage-authoring tool) and somewhere to run. The stage-authoring tool must draw through the client's shader (ADR-0002), so the client side is TypeScript + three.js regardless. We decided the API and curation build are TypeScript too: Node LTS, Fastify, Vite and Vitest in one pnpm workspace, with a shared package for the content bundle schema and the shader, so both are defined once. The API runs on THALES the way city-pulse does: its own namespace, public through cloudflared, built and deployed by Jenkins, with the Play Token signing key from Vault via ESO. It serves the built client from the same origin, and keeps the Result counters in a small Postgres in the same namespace, so the API itself is stateless and can run more than one replica. Because this repo is public, curation inputs (Guess Vocabulary, Answer Pool, Pins, models, rendered Reveal Stages) live in a separate private repo. Jenkins runs the curation build there and ships the content bundle as its own image to the THALES LAN registry, which the API pod mounts; how a publish works is ADR-0008. The stage-authoring tool runs only on the curator's machine, against a checkout of the content repo.

## Considered Options

- **Go API and curation build, as city-pulse** — rejected: the bundle schema and Feedback types would be defined twice and kept in sync by hand or generation.
- **Bun + Hono** — rejected: less mature in the Jenkins/kaniko build images; Fastify's in-process request injection fits the seam-1 test harness.
- **Static client on a CDN, API on THALES** — rejected: the game is unplayable without the API anyway (ADR-0001), so it gains bandwidth, not availability.
- **Fully managed edge hosting** — rejected: best availability, but nothing of it runs on THALES.
- **SQLite on a volume for the counters** — rejected: a ReadWriteOnce volume pins the API to one replica.
- **Valkey/Redis for the counters** — rejected: one more stateful service whose durability depends on persistence settings.
- **Content bundle published into Postgres** — rejected: binary models in the database, and the curator's machine would need database access.
- **Content in this repo** — rejected: the repo is public, so the Schedule and Attributes would leak.
- **Deployed authoring tool** — rejected: needs auth and write access to the content repo from the cluster, for a single curator.

## Consequences

- Objectle's availability is THALES's: a THALES outage takes that day's game down.
- Model downloads (stage assets, Ghosts) come off the home uplink.
- Re-planning the Schedule is a push to the content repo, which publishes a new content image; no client release (ADR-0008).
- About 700 models sit in the content repo in plain git, not Git LFS (ADR-0008).
- Jenkins needs a Node build image alongside the existing Go one.
- The content image must never be pushed to a public registry.
- The public hostname is chosen when the walking skeleton is deployed.
