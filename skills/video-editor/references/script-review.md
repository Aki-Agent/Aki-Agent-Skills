# Script consistency review (optional)

Run only when the user asks for it. The goal is a kept script that reads as one clean explanation: no repeated takes, no abandoned sentences, no leftovers of earlier cuts. `review-script.cjs` prepares the material; the decisions are yours, and you apply them without asking; the user reviews the result in Remotion Studio.

```powershell
node <SKILL_DIR>/scripts/review-script.cjs "<WORK_DIR>/transcript.json" "<PROJECT_DIR>" "<WORK_DIR>/review.json"
```

The third argument can also be a plan JSON with `clips`, or `-` to review the whole transcript. It writes `review.json` and a readable `review.txt`: every kept word with its transcript index, lines with source start times, and `‖` marks for pauses in the source (measured before silence cuts, so they show where the speaker stopped, not what the viewer hears).

## Read the whole kept script first

Read `review.txt` top to bottom as the viewer will hear it. The hints at the end are leads, not verdicts: parallel phrasing that repeats by design, such as the same "we did not know…" clause twice, is intentional, and most pauses are just thinking.

Also list the runs the current edit already removes (words with `kept: false` in `review.json`). Cuts made earlier often leave two or three words behind whose sentence was removed, and those only show up when you read the edges of every removed run. On the test video, `small` turned three words at 417.1–417.3 s into the start of a new phrase, while `medium` heard the end of a sentence the edit had already removed.

## What to remove

| Case | Signal | Remove |
|---|---|---|
| Repeated take | Same phrase twice within a few seconds (`repeats`) | The first take, unless the second is worse |
| Self-correction | A word corrected later in the same sentence, when it was not a list | The wrong version, keep the correction |
| False start | A sentence that stops (`hanging`, `truncated`) and restarts | From the abandoned start up to the first word of the full take |
| Change of approach | An explanation abandoned after a pause and replaced by a different one | The abandoned explanation, only if the new one covers it |
| Leftover of a cut | One to three words between a removed run and the next sentence | The leftover |
| Off-topic aside | An outburst or comment to someone off camera | The aside |

Do not remove:

- emphasis and rhetorical restatement, where a clause is repeated to broaden the audience, unless the user asks for a tighter cut;
- the only take of a sentence, even with a grammar slip (fix the caption instead);
- a word that sounds stumbled but has no clean alternative take; fix its caption spelling in `src/captions.js`.

## Check the audio, not only the text

The transcript can hide a stumble or invent words:

- A kept clip with no words (see `wordlessClips` in `detect-noises.cjs`) can be speech Whisper missed. Re-transcribe it with `transcribe.py --clip START,END --model medium`, with about 1 s of context on each side. On a 10-minute test video, one such clip was a first take of a word the full transcript had only 3.7 s later.
- `medium` returning only a thank-you or a subtitle-marker phrase over a short sound is a Whisper hallucination: treat it as non-speech and ask the user to listen.
- A word with very low probability (`low_confidence_words`) and an unusual length may be a filler or a stumble that Whisper turned into a word.

## Apply, then report

Keep one table for the final report: transcript indices, source seconds, the text removed, the reason, and the sentence as it reads after the cut. Apply it directly, without waiting for approval: split clips at energy minima below −40 dB, as in "Cutting false starts and stumbles", and run `validate-edit.cjs`.
