# Publishing reads the Schedule back from the deployed content image

ADR-0004 ships the content bundle as its own image, built by Jenkins from the private content repo, and ADR-0007 has every curation build extend the previously published Schedule. We decided publishing is automatic: every push to the content repo's main branch and a nightly run each publish, the nightly run being what keeps the Planning Horizon full when nobody is curating. Each publish takes the previously published Schedule from the `bundle.json` of the content image the deployment currently names, not from a file in the content repo, so "published" means "being served" by construction and no write-back can fall behind it.

## Rules

- **The Launch Date has one source:** the API deployment's configuration. The publish pipeline reads it from the same GitOps file that names the deployed content image and passes it to the curation build; the bundle records the Launch Date it was built for, and the API refuses to start on a bundle built for another one. The Launch Date never changes once Puzzle Number 1 has been played.
- **Midnight guard.** Immediately before the deploy commit, the pipeline compares the new bundle's Schedule with the deployed one on every Puzzle Number up to the one active at that moment, and does not deploy if any differs. The next publish rebuilds from the then-current state.
- **Mounting.** The API pod mounts the content image as a read-only image volume; the content image holds only the bundle. A publish changes the image reference, which rolls the pods.
- **Layers.** `bundle.json` sits alone in the top layer, and models and stage images are spread across about 16 layers by a hash of the noun, built reproducibly so unchanged layers keep their digests. A nightly publish that only extends the Schedule then adds kilobytes to the registry, and re-preparing one model rewrites about a sixteenth of the content.
- **Retention.** The pipeline keeps the deployed content image and the five before it, deletes older content images from the LAN registry, and garbage-collects. It touches no other image.
- **Monitoring.** The API exports how many Puzzle Numbers the served Schedule covers past the active one. Alerts fire below 83 (about a week of failed publishes, or an Answer Pool falling behind) and below 14 (two weeks before players get no Daily Object). One signal covers a broken pipeline, a Schedule shortfall and a stuck content image.
- **Storage.** Models are in plain git, not Git LFS, and CI clones at depth 1. Every file is far below GitHub's per-file limit, and a throwaway CI agent re-downloads the whole content set on every publish, which LFS would bill as bandwidth.
- **Launch.** The placeholder game played before launch does not count. Before the first real publish the deployment gets the real, future Launch Date and the Result counters are emptied; the first publish refuses to run while the deployed Launch Date is past and no content image has been published. Until the Launch Date every player is told Objectle has not launched yet.

## Considered Options

- **A manual publish step (a tag or release)** — rejected: the Schedule would only extend when the curator remembered to publish.
- **Writing the Schedule back into `schedule.json` in the content repo** — rejected: CI needs push access to the content repo, the nightly run makes a bot commit every day, and a pipeline that dies between the deploy commit and the write-back leaves the recorded Schedule behind the served one, so the next build could reassign a Puzzle Number that had gone live.
- **The Launch Date in the content repo, read by the API from the bundle** — rejected: the spec keeps it in configuration, not in the bundle. Two copies with only a mismatch check was workable but left two places to edit.
- **Copying the bundle into an `emptyDir` from an init container** — rejected: it needs a shell in the content image and a gigabyte or two of ephemeral storage per pod, and lengthens every rollout.
- **Accepting the midnight window, or refusing to build near midnight** — rejected: the comparison costs one read-back the pipeline already does.
- **Alerting on failed Jenkins builds** — rejected: it misses a shortfall, which passes the build.

## Consequences

- The curator sees the upcoming Schedule in the publish output, or by running the curation build locally against the deployed image, not in the content repo.
- The first publish starts from an empty Schedule.
- The content pipeline needs read access to the cluster's GitOps repo (it already writes the deploy commit there) and delete rights on the content repository of the LAN registry.
- The content repo needs a push webhook to Jenkins, or a push publishes only on the daily scan; the nightly run needs a cron trigger.
- Pushes that land close together must not publish concurrently, or the later one deploys a Schedule extended from the bundle the earlier one replaced, undoing its assignments.
