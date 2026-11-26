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

**Launch Date**:
The Pacific date of Puzzle Number 1, from which every later Puzzle Number is counted.
_Avoid_: start date, epoch

**Reveal Stage**:
One of six fixed steps of increasing disclosure of the Daily Object, alternating between shape and surface information (shape stages show no surface relief): 1, a surface crop lying wholly inside the object's outline; 2, a silhouette; 3, a wider surface crop; 4, a clay render; 5, the whole object rendered; 6, the stage-5 view with free orbit and the first letter.
_Avoid_: hint, level, step, clue

**Guess**:
A player's attempt to name the Daily Object, chosen from the Guess Vocabulary; each wrong Guess advances one Reveal Stage, and a noun the player already guessed is refused without counting as a Guess.
_Avoid_: try, attempt, answer

### Nouns and their data

**Guess Vocabulary**:
The full set of nouns a player can submit as a Guess; every member has a model and all four Attributes, and a name specific enough to need no picture; no model carries a brand logo.
_Avoid_: word list, dictionary, catalog

**Answer Pool**:
The subset of the Guess Vocabulary eligible to become a Daily Object; only its members have authored Reveal Stages, and each must be modelled as a prototypical example of its noun.
_Avoid_: answer list, puzzle bank

**Attribute**:
One of four properties every Guess is scored against the Daily Object on: category, size, natural vs. made, primary material.
_Avoid_: trait, property, tag, feature

**Category**:
The Attribute naming what a noun is mainly for; every noun has exactly one, decided by its primary purpose.
_Avoid_: type, kind, room, section

**Size**:
The Attribute giving the longest dimension, in metres, of a typical example of a noun; a Ghost is drawn so its longest dimension matches it.
_Avoid_: volume, height, scale

**Primary Material**:
The Attribute naming the material that covers the largest visible surface of a typical example of a noun (its classic, iconic form where old and modern forms differ), not what it is best known for being made of; a material is named by what it looks like, so a carbon-fibre frame counts as plastic; a screen counts as part of its device's plastic body, not as glass.
_Avoid_: main material, made of, construction

**Ghost**:
A wrong Guess's model shown beside the hidden Daily Object at true relative scale.
_Avoid_: comparison model, overlay, shadow

**Credit**:
The attribution owed to a model's author, shown for the Daily Object and Ghosts only once the game ends, and for every model on a standing credits page.
_Avoid_: attribution line, license notice

### Curation

**Difficulty Rating**:
The curator's judgment of how hard a Daily Object is (easy, medium or hard), recorded when its Reveal Stages are authored.
_Avoid_: difficulty score, hardness

**Pin**:
A fixed assignment of a specific Answer Pool object to a specific date, which the schedule is generated around.
_Avoid_: lock, reservation, override

**Schedule**:
The assignment of an Answer Pool object to every Puzzle Number, generated around Pins; past Puzzle Numbers are never reassigned.
_Avoid_: calendar, rotation, playlist

**Stage Camera**:
The fixed view the curator chose for an authored Reveal Stage; a Stage Camera for Reveal Stages 1–3 never frames readable text.
_Avoid_: viewpoint, shot, angle

### Play

**Play Token**:
The signed record of one player's progress through one Puzzle Number, carried by the client instead of stored on the server.
_Avoid_: session, game state, cookie

**Result**:
How a player's game ended: solved at a given Reveal Stage, or failed after six Guesses.
_Avoid_: score, outcome

**Feedback**:
The per-Attribute comparison returned for a wrong Guess against the Daily Object; size reads bigger, smaller or similar, where similar means neither object's size is more than 1.25 times the other's.
_Avoid_: hint, clue, score

**Distribution**:
The count of each Result among all players who have finished one Puzzle Number so far.
_Avoid_: stats, histogram, leaderboard

**Beat Percentage**:
The share of other players who have finished the same Puzzle Number so far whose Result was worse than the player's, with players on the same Result counting half; while no other player has finished there is none, and the player is the first to finish.
_Avoid_: percentile, rank
