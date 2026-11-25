# Objectle

A daily guessing game: each day every player identifies the same everyday object from a 3D model that reveals more with each wrong guess.

## Language

### The puzzle

**Daily Object**:
The single object every player is trying to identify on a given day.
_Avoid_: answer of the day, target, solution

**Puzzle Number**:
The sequential identity of one day's puzzle, shared by all players; the day turns over at midnight Pacific.
_Avoid_: puzzle ID, day number, date

**Reveal Stage**:
One of six fixed steps of increasing disclosure of the Daily Object, alternating between shape and surface information; stage 6 adds free orbit and the first letter.
_Avoid_: hint, level, step, clue

**Guess**:
A player's attempt to name the Daily Object, chosen from the Guess Vocabulary; each wrong Guess advances one Reveal Stage.
_Avoid_: try, attempt, answer

### Nouns and their data

**Guess Vocabulary**:
The full set of nouns a player can submit as a Guess; every member has a model and all four Attributes.
_Avoid_: word list, dictionary, catalog

**Answer Pool**:
The subset of the Guess Vocabulary eligible to become a Daily Object; only its members have authored Reveal Stages.
_Avoid_: answer list, puzzle bank

**Attribute**:
One of four properties every Guess is scored against the Daily Object on: category, size, natural vs. made, primary material.
_Avoid_: trait, property, tag, feature

**Ghost**:
A wrong Guess's model shown beside the hidden Daily Object at true relative scale.
_Avoid_: comparison model, overlay, shadow

### Curation

**Difficulty Rating**:
The curator's judgment of how hard a Daily Object is, recorded when its Reveal Stages are authored.
_Avoid_: difficulty score, hardness

**Pin**:
A fixed assignment of a specific Answer Pool object to a specific date, which the schedule is generated around.
_Avoid_: lock, reservation, override

### Play

**Play Token**:
The signed record of one player's progress through one Puzzle Number, carried by the client instead of stored on the server.
_Avoid_: session, game state, cookie

**Result**:
How a player's game ended: solved at a given Reveal Stage, or failed after six Guesses.
_Avoid_: score, outcome
