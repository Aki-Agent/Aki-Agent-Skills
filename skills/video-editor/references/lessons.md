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

## Studio drops audio at clip joins (4K source, 62-clip edit)

Symptom the user reports: while reviewing in Studio, the audio cuts out for a fraction of a second at random moments, and it is impossible to tell a real bad cut from a preview glitch. Renders never show it.

Measured by hooking `AudioBufferSourceNode.prototype.start` in the Studio page and summing the gaps between consecutive scheduled ranges, playing 30 s from frame 0 on every cold page load:

| Variant | Dropped audio per 30 s |
|---|---|
| 62-clip edit, one player per clip (original) | 1600-2043 ms |
| Same edit, `premountFor` 3 s instead of 1 s | 0-719 ms, still glitches |
| Same edit, muted `<Video>` + separate `<Audio>` per clip | 2043 ms |
| Same edit, single continuous preview track | **0-107 ms, three cold runs** |
| 20-clip test edit, composition at 30 fps vs 60 fps | both clean |
| 20-clip test edit, composition 480 px vs 2160 px | both clean |
| Audio-only composition | never dropped |

What the data says:

- The drops land on joins, not at random: 550-725 ms right after a cut, sometimes followed by 50-200 ms holes.
- At every drop the scheduling lead (`when - audioContext.currentTime` passed to `start`) fell to **0.000 s**; the rest of the time it stayed near 2 s. The audio scheduler ran out of buffer because the new clip's audio seek was not ready.
- No `longtask` entries during the drops and rAF stayed at 47-60 fps, so the main thread was not blocked and the machine was not short of CPU.
- `premountFor` alone does not fix it: premounting the video player does not premount that player's audio seek.
- Splitting video and audio into two players does not fix it either; the seek still happens per clip.
- Composition fps and size are not causes. A clean 1-clip project at 60 fps glitched once in one run and not in others, which is why the bug looked intermittent: it depends on whether the seek wins the race.

Fix now enforced by the template: `scripts/preview-audio.cjs` concatenates the kept clips into one `public/preview-audio.wav` (same FFmpeg `atrim`+`concat` graph `export.cjs` uses for the render audio), `edit.js` carries `previewAudio`, and `Video.jsx` plays the clips muted plus that single `<Audio>` in Studio only. No seek at the joins, nothing to race.

Sync check: 9701 frames at 60 fps = 161.683 s and the built track measured 161.6833 s, 0.0003 s apart. The script refuses to write a track that differs from the edit by more than half a frame, so a wrong `fps` or a stale `edit.js` fails loudly instead of drifting silently.

Rebuild cost on the 62-clip, 161.7 s edit: about 1 s of FFmpeg and a 31 MB WAV, so `cut.cjs` rebuilds it on every cut and undo.

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

## Cards ignored the vertical safe zones (2160×3840, 60 fps)

`Backdrop` used `padding: "8%"`. CSS resolves every percentage padding against the **width**, so on a
2160×3840 frame that is 173 px on all four sides, not 8 % of the height. Measured against the guide
drawn by `showSafeZones`: text began at y = 173 with the top UI reaching 384, and ended at 3667 with
the bottom UI starting at 3072 — the card was under both bands, and the right edge (1987) was past the
action rail (1814). Two cards made it worse by setting their own padding (`split` at `"6% 8%"`,
`endcard` at `"10% 8%"`). Insets are now computed in pixels from the frame height (13 % / 24 % / 17 %
/ 6 %), giving a content box of 130–1793 × 499–2918 px, inside all three limits. Verified with stills
at frames 3000, 4680 and 9900.

## A closing card covered the last words (same edit)

`durationInFrames` was the sum of the clips, so an `endcard` placed "at the end" necessarily sat on
top of the speech: it ran 155.767–161.767 s while the voice ended at 161.85 s. A silent tail is now
part of the composition (`outro`, in seconds) and music stops with the speech instead of running to
the last frame. After the change the card runs 162.783–167.783 s with `outro: 5`, and the mixed
preview reads −99 dB in the tail against −21.2 dB just before it.

## A word can be lost at a join even when the clip looks right

A final plural consonant was cut off. The clip ended at 135.817 s and the transcript placed the word at
135.50–135.82 s, so the timestamps said it fit; the 5 ms energy profile showed the consonant running to
135.865 s. Extending the clip to 135.9 s was not enough either: the next kept clip started at
136.84 s, cutting a phrase mid-sentence. Joining the whole phrase (clip to 137.027 s, dropping the
0.187 s clip that followed) fixed it. The screen anchor also pointed to an occurrence inside a removed
range, which snapped it to the next clip and made it collide with the previous screen. Anchors resolve
against the **kept** captions, so an occurrence that was cut does not exist — check `resolveItem`
output, not the raw transcript.
