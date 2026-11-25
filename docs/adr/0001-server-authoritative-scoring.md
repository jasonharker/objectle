# Guesses are scored by a server, not in the client

Most daily guessing games are pure static sites that ship the schedule and answers in the bundle. Objectle can't: scoring a wrong Guess on its four Attributes requires the Daily Object's Attributes, so a client-side scorer would leak today's answer, and a shipped schedule leaks every future one. We decided a small scoring API holds the schedule and Answer Pool, serves only the current Reveal Stage's anonymized assets, returns Attribute feedback per Guess, and discloses the Daily Object's name only when the game ends. Progress is carried in a stateless signed Play Token, so gameplay needs no per-player storage; the only server-side state is anonymous per-puzzle Result counters.

## Considered Options

- **Ship everything (pure static)** — rejected: today's and future answers readable from the bundle.
- **Daily publish job, no API** — rejected: hides future answers, but today's Attributes still ship for scoring, so today's answer is deducible.

## Consequences

- An outage of the API takes the game down for that day; the static frontend alone is unplayable.
- The fixed midnight-Pacific rollover keeps the server to one active Puzzle Number at a time.
- The schedule can be re-planned (Pins, reordering) at any time without a client release, as long as past Puzzle Numbers are never reassigned.
- A player can restart in a private window; accepted at this scale.
