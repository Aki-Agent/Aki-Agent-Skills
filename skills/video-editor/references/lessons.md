# Measured lessons behind the video-editor defaults

Case notes that justify the defaults in `SKILL.md`. Read them when a default does not fit a recording; `SKILL.md` keeps only the rules.

## Silence sensitivity (`clip-a.mp4`, 237.6 s, one speaker)

- A conservative first pass (silences of at least 1.2 s, a 0.23 s margin, discarding any cut that touched a word guard) removed 14 pauses and left 194.1 s. The user rejected it as leaving many silences.
- `-35dB`, minimum 0.5 s, 0.08 s kept at each edge and a 0.08 s word guard produced 45 cuts and 149.8 s from 50 detected silences, and was approved.

## Word guards fight the cut (`clip-b.mp4`, 252.9 s, 720×1280, 30 fps)

With the `clip-a` parameters the plan cut 40 pauses and left 194.3 s, but the rendered audio still had 40+ pauses of 0.45–0.9 s. Two measured causes:

1. **`silencedetect` needs one unbroken silence.** A pause broken by a noise spike into 0.2 s fragments never reaches a 0.5 s minimum. Detecting with `d=0.25` found 85 pauses instead of 57.
2. **Word spans are stretched into the pauses.** faster-whisper places word starts earlier and ends later than the audio. A guard around those spans re-extends every cut into the silence. 49 of 49 detected pauses were "blocked by a word", and every blocked word sat entirely inside silence.

Fix, now implemented by `scripts/plan-silence.cjs`: detect at `d=0.25` with 0.07 s edges, build clips as the complement of the silences, re-detect on the joined audio until a pass adds nothing, audit removed slices against the transcript, verify the joined audio. Result: 175.2 s, 30.7 % removed, 0 pauses over 0.40 s, no word cut.

Noise floor: on `clip-b.mp4` pauses peaked at −33 dB (breath and room tone) while speech averaged −25 dB, so the −35 dB gate fragmented the pauses. A word span can read −34 dB over 0.8 s and still be mostly silence with speech only at the start; confirm with 0.1 s windows before touching the threshold.

## Stumbles (`clip-c.mp4`, 2160×3840, 60 fps, 42.4 s)

- The silence plan gave 13 cuts and 33.5 s. The false start ("first take breaks off mid-word, speaker restarts") was 3.0 s and took the edit to 30.5 s.
- Silence detection never proposes this cut: the words are spoken continuously.
- The exit and re-entry points read below −40 dB in a 20 ms energy profile.
- Rebuilding captions with a fixed overlap threshold dropped a real two-letter word that sat inside a clip; `min(0.05 s, word length)` kept it. The template now applies that rule at runtime (`keptCaptions` in `timeline.mjs`).
- Comparing word start times against clip starts drops words that start a few milliseconds before the clip and are still fully spoken.

## Visual budget

A 175.3 s edit shipped with 5 overlays (`callout`, `badge`, `alert`, `icon`, `cta`) and the user asked for fewer. Screens carry the information; overlays are kept for 1–2 moments per video.

## Large sources (4K / 60 fps)

- `clip-a.mp4` at 2160×3840, 60 fps: a 2 s test export took about 46 s including preparation, and Remotion estimated about 36 minutes for the full 237.6 s video.
- A 149.9 s 720×1280 preview rendered in about 3 minutes with `--concurrency=4`.
- Before the proxy switch existed, previews used a separate 720×1280/30 fps project with the same `edit.js`. `create-project.cjs` now writes a proxy into the same project and Studio plays it automatically.

## Caption placement

The first template drew captions inside the zoomed clip, so every punch-in also scaled the text. Captions are now a sibling layer outside the zoom.

## Overlay placement used width-relative padding

`Place` used `padding: "7% 5% 26%"`. CSS percentage padding is relative to the **width**, so the documented "26 % from the bottom" was 14.6 % of the height on a 2160×3840 frame and 46 % on 1920×1080, and a `center` overlay landed on the centered captions (51–71.5 % against captions at 54–58 %). Padding is now computed in pixels from the frame height; the same overlay measures 28.7–49.2 %.

## Large titles

A single 15-letter uppercase word in `kinetic` overflowed a 720 px vertical frame; large titles now shrink so the longest word fits.
