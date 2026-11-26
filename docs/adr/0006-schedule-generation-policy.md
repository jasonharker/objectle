# Schedule generation policy

The curation build fills every unpinned Puzzle Number through the Planning Horizon from the Answer Pool, and each Answer Pool object takes six authored Reveal Stages, so authored objects are the scarce resource. We decided an object may be the Daily Object again only after a Repeat Gap of 365 Puzzle Numbers. Never repeating would put an end date on a game whose Guess Vocabulary targets about 700 nouns. The Planning Horizon is 90 Puzzle Numbers past the active one (before launch, past Puzzle Number 1): that is enough buffer to survive a stalled curator without authoring a year of objects before launch. A published assignment is kept by later builds, so re-planning can never reassign a Puzzle Number that turned active between build and deploy, and the upcoming Schedule a curator sees is the one that will run.

## Rules

- **Pins** are exempt from the Repeat Gap, so yearly themed days on floating holidays (364 days apart) still build. The generator never places a pinned object anywhere unpinned within 365 Puzzle Numbers of its Pin, on either side. A Pin on a past or active date fails the build.
- **Keeping assignments.** Each build extends the previously published Schedule from its old end out to the Planning Horizon. An unpinned future Puzzle Number is refilled only when its object left the Answer Pool, a new Pin took its date, or a new Pin put it inside its object's Repeat Gap. A past or active Puzzle Number is never reassigned, even after its object leaves the Answer Pool.
- **Difficulty Pattern.** Generated days aim for easy Monday and Tuesday, medium Wednesday and Thursday, hard Friday and Saturday, and medium Sunday (Pacific weekday). Pins ignore it. When no eligible object has the target rating, the generator falls back: hard to medium then easy; easy to medium then hard; medium to easy then hard.
- **Choosing an object.** Among the eligible objects, the one whose last appearance is oldest wins, with never-appeared counting as oldest. Ties are broken by a shuffle seeded from the Puzzle Number, so the same input gives the same Schedule but the order can't be read from the public code.
- **Shortfall.** The Repeat Gap is never relaxed. When no object of any rating is eligible, the Schedule stops there and the build still passes, reporting the last Puzzle Number covered, the days short of the Planning Horizon, and every Difficulty Pattern substitution.

## Considered Options

- **Never repeat** — rejected: under two years of Daily Objects from a 700-noun Guess Vocabulary.
- **Regenerate the whole future Schedule each build** — rejected: a build deployed just after midnight Pacific would reassign the newly active Puzzle Number under players who had already started it.
- **Fail the build when the Planning Horizon can't be filled** — rejected: running short on authored objects would block unrelated content fixes.
- **A proportional difficulty mix** — rejected in favour of a weekday rhythm players can learn.

## Consequences

- A newly authored object usually first appears about 90 days out unless it is Pinned.
- Authoring to the Difficulty Pattern means roughly 2 easy, 3 medium and 2 hard objects per week.
- A shortfall is visible only in the build output; alerting on the days of Schedule left is separate operational work.
- Past Schedule entries may name nouns no longer in the Answer Pool, so the content check that every Schedule entry is in the Answer Pool applies only to the active and future Puzzle Numbers.
