---
name: video-editor
description: Edit local videos with Remotion Studio in the agent harness you are working in: transcribe, cut silences and stumbles, and add captions, zooms, full-screen cards and overlays while the user reviews a headed preview. Use when the user asks to edit, cut, caption or decorate a local video file.
---

# Video editing with Remotion

Run locally, in the harness you are working in. Keep the video project in the agent workspace, outside this skill and other repositories. Keep the original media unchanged. Do not commit generated videos, transcripts, or project data. Do not commit or push skill changes unless the user asks. Measured case notes behind every default are in [references/lessons.md](references/lessons.md).

## First run: requirements and install

Check every row before the first edit and install only what is missing; ask the user before installing system software or downloading models. Verified on Windows 11 (16 threads, no usable GPU).

| Requirement | Minimum | Verified here | Used by | Check |
|---|---|---|---|---|
| Node.js | 18 (global `fetch`, `node --test`; Remotion 4 alone needs 16) | 22.13.1 | every script, Remotion | `node -v` |
| npm | a working npm; a broken Corepack shim is retried as `npx npm@10.9.2` | the Corepack shim failed (`unable to verify the first certificate`) | first shared Remotion install | `npm -v` |
| FFmpeg + ffprobe on PATH | 7 | 8.1.2 (gyan.dev full build) | proxy, silences, cuts, music, sound effects, export | `ffmpeg -version`, `ffprobe -version` |
| Python | 3.9 (`Requires-Python` of faster-whisper 1.2.1) | 3.11.9 | transcription | `py -3 --version` (Windows), `python3 --version` |
| faster-whisper, in a venv | 1.2.1 (pinned) | 1.2.1 with av 18.1.0, ctranslate2 4.8.4, onnxruntime 1.31.1, tokenizers 0.23.3 | `transcribe.py`, `locate.cjs` | `<VENV>/Scripts/python.exe -c "import faster_whisper; print(faster_whisper.__version__)"` |
| Whisper models | `small` (transcription); `medium` (`locate --medium`, re-checks) | downloaded once with `--allow-download` | `transcribe.py` | the `--cache-dir` folder |
| Remotion | `remotion`, `@remotion/cli`, `@remotion/media`, `@remotion/captions` 4.0.546; `react`, `react-dom` 19.2.0 (pinned in `create-project.cjs`) | 4.0.546 | Studio, stills, renders | installed once into the shared `.cache/video-editor/remotion-4.0.546` |
| Chrome Headless Shell | downloaded by Remotion on the first still or render | 158.0.8127.2-remotion-v3 | stills, renders | `node_modules/.remotion/chrome-headless-shell/` |
| curl | any (Windows 10+ ships `curl.exe`) | 8.22.0 (Schannel) | `sfx.cjs`, `find-image.cjs` when Node's `fetch` fails TLS | `curl --version` |

First run, in order:

1. Run the checks above. Install what is missing: Node from nodejs.org or nvm; FFmpeg with `winget install Gyan.FFmpeg`, `brew install ffmpeg` or `apt install ffmpeg`; Python 3.11 from python.org.
2. Create the venv and install `faster-whisper==1.2.1` (see "1. Transcribe locally").
3. Ask the user, then download `small` with `transcribe.py --allow-download` (a few hundred MB); `medium` only the first time a re-check needs it.
4. `create-project.cjs` installs the pinned Remotion packages once; later projects reuse them.
5. The first still or render downloads Chrome Headless Shell (on certificate errors see "7. Render and verify").
6. `node --test skills/video-editor/tests/video-editor.test.cjs` (14 tests, Node and FFmpeg only; 16.1 s here).

Network is needed only for these installs, the models, sound effects and images. Here Node's `fetch` failed every HTTPS request with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` while `curl.exe` (system certificate store) worked, so `scripts/net.cjs` falls back to curl. Never disable TLS verification.

## Fast path (default)

Most of an edit's time used to go into the agent chaining steps by hand and writing one-off scan, map and fix scripts. Do not write such scripts: these two commands cover the mechanical work, and the agent only makes the editorial decisions.

1. **One command to a cut project**, in the background:

   ```powershell
   node <SKILL_DIR>/scripts/auto-edit.cjs "<VIDEO>" "<WORK_DIR>" --python="<VENV>/Scripts/python.exe" --cache-dir="<HF_CACHE>" [--deps=<DIR with node_modules>]
   ```

   It transcribes while it creates the project and proxy (the two slowest steps, in parallel), plans silences, writes clips and captions, removes noise-only wordless clips and likely noises whose edges are below −40 dB, writes `review.txt`, validates, and prints a summary (`auto-edit.json`). Voiced wordless clips are kept and listed in `voicedWordlessClips`. Measured on a 10-minute, 2160×3840, 60 fps talking head: 547.7 s with no agent work in between (transcribe 499.6 s in parallel with project + proxy 477.2 s, silences 45.1 s, noises 1.8 s, review 0.4 s, validation 0.8 s); 601.1 → 247.6 s, and both bursts of the known throat clearing were removed automatically. The proxy encode from 4K is now the cost to beat after transcription.
2. **Open Studio now** (see "Create and open the project") and keep it open; every later step hot-reloads.
3. **One read of `review.txt`, one cut call.** Decide every script cut with [references/script-review.md](references/script-review.md) and apply them all together:

   ```powershell
   node <SKILL_DIR>/scripts/cut.cjs "<WORK_DIR>/project" words:812-830 words:1204-1210 "text:\"o sea lo que\""
   ```

   Re-transcribe at `medium` (`locate.cjs source:<t> --medium`, see "Fixing what the user points out") only the `voicedWordlessClips` and words you truly doubt; nothing else. On the test video, one call applied 6 script cuts and 3 clip cuts (247.6 → 217.3 s, 88 words, every join −68 to −76 dB). When `small` mistimed a stumble, a `words:` edge can land inside the good take (`--dry-run` shows it); then remove the whole clip with `source:` and the clip's own edges.
4. **Theme, screens and zooms** in `src/edit.js`, anchored to words or source time so later cuts never need remapping. Edit only the `theme`, `zooms`, `screens`, `overlays` and `sfx` keys; `cut.cjs` rewrites `clips` and `music.cjs` writes `music`. Images, sound effects and music: see "Images of people, companies and products", "Sound effects" and "Background music". Set the whole brand palette as `theme` first (for Anthropic or Claude topics, the one in [Brand palettes](references/themes.md#brand-palettes)); a bare `{preset: "editorial"}` brings the preset's teal and amber.
5. `validate-edit.cjs`, reload Studio, report. Render only after approval, with `scripts/export.cjs` (1080p 30 fps by default; see "Render and verify").

## Fixing what the user points out (surgical, no new pipeline)

Every request after the preview is **locate → one dry run → one cut call → captions → reload**. Never re-run `auto-edit.cjs`, never write scan, map or fix scripts, and never guess times from `review.txt` alone. Measured on the 10-minute test video, four requests (a repeated start at 0:41, a throat clearing after a phrase, "como se… como se estaba", "pero es duro" said twice): about 10 `locate` calls of 8–11 s each with `medium`, one `cut.cjs --dry-run` and one `captions.cjs --dry-run` (215.7 → 212.8 s, every edge −55 to −76 dB).

1. **Locate each request** with what the user gave (Studio time or words):

   ```powershell
   node <SKILL_DIR>/scripts/locate.cjs "<WORK_DIR>/project" output:0:41 --medium
   node <SKILL_DIR>/scripts/locate.cjs "<WORK_DIR>/project" "text:\"agencias gubernamentales selectas\""
   ```

   It prints the words around that point with source and Studio time and `kept` / `cut` / `part` (`part` = clipped by an earlier cut), the kept clips plus one on each side (wordless clips flagged), and with `--medium` the words `medium` hears in that window (cached in `WORK_DIR/locate/`; `--python`, `--cache-dir` and `--language` come from `auto-edit.json`).
2. **Repetitions hide in the transcript.** `small` usually writes a repeated start once ("como es" for "como esto es… como es"), or stretches one word over both takes (`locate` flags words over 1.2 s). `medium` over 5–8 s can merge them too. Then narrow the window to one clip, `source:<clip middle> --window=<clip length + 0.2>`: on single clips `medium` separated every take of the test video.
3. **Pick the spec** from what `locate` shows:

   | Case | What `locate` shows | Spec |
   |---|---|---|
   | repeated start, the bad take is its own clip | that clip holds only the first take | `source:<clip start>-<clip end>` |
   | bad take at the end of a clip with good words | `medium` times of the take | `source:<end of last good word>-<clip end>` |
   | noise or throat clearing after a phrase | the next clip is flagged "(no words…)" | `source:<that clip>` |
   | the good take starts with a word marked `part` | a word clipped by an earlier cut | `keep:<word start>-<clip start>` |
   | a phrase transcribed once and correctly | its word indices | `words:A-B` or `"text:\"…\""` (`@2` for the second) |
   | "cut 1:23 to 1:30" | — | `output:1:23-1:30` |

   `source:`, `output:` and `keep:` edges move to the quietest 20 ms within ±80 ms (`--exact` keeps them); word edges go to the quietest 20 ms between the neighboring words. `keep:` is applied before the cuts.
4. **All specs in one dry run, then the same call without `--dry-run`:** `node <SKILL_DIR>/scripts/cut.cjs "<WORK_DIR>/project" <spec>... --dry-run`. Check `removedWords`, `restoredWords` and that no edge warning is printed (above −40 dB).
5. **Captions follow what is heard.** Words of removed takes drop automatically. Words `small` never transcribed (often the kept take of a repetition) are missing, so replace that window with the `medium` words; pick a window that ends in a pause. Fix names in the same call:

   ```powershell
   node <SKILL_DIR>/scripts/captions.cjs "<WORK_DIR>/project" --from="<WORK_DIR>/locate/medium-77-83.json" --replace=Anthropiq=Anthropic --dry-run
   ```

   Word indices change after `--from`: locate again instead of reusing `review.txt` indices.
6. Reload Studio and report each fix with its Studio time. `cut.cjs --undo` and `captions.cjs --undo` revert the last run of each (history in `src/edit-history/`). `cut.cjs` writes `edit.js` back as JSON, so comments in it are lost.

The four test requests resolved to (dry run with measured edges; confirm by ear in Studio):

| Request | Found with `locate` | Specs |
|---|---|---|
| 0:41 "como esto es… como es técnicamente" | the clip `small` called "como es" is "como esto es" in `medium` | `source:72.525-73.593`, captions `--from` the 77–83 s window |
| throat clearing after "selectas" | wordless clip after a 20.9 s pause | `source:396.89-397.354` |
| "como se… como se estaba especulando" | single-clip windows: first take ends its clip; second "como" starts 0.3 s before its clip | `source:579.62-580.04 keep:580.95-581.25`, captions `--from` 580.9–582.1 |
| "pero es duro" twice | first take is two clips ("pero es duro" + "pensar que viene"); "Pero" of the second is `part` | `source:587.92-589.66 keep:589.9-590.06`, captions `--from` 589.9–591.9 |

**Other adjustments:**

| User says | Do |
|---|---|
| "move/shorten this screen" | edit that item in `edit.js`; anchors keep it in place after cuts |
| "the colors are wrong", "the text does not read" | change only `theme` in `edit.js` (whole palette, see [Brand palettes](references/themes.md#brand-palettes)), `validate-edit.cjs`, reload |

A project keeps the copy of `src/components.jsx` it was created with. After a template fix, copy `<SKILL_DIR>/template/components.jsx` over it only when the project copy was not customized (`fc` against the template shows no other change).

## Pipeline

| Step | Command | Measured on a 42.4 s, 2160×3840, 60 fps talking head |
|---|---|---|
| 1. Transcribe | `python scripts/transcribe.py` | 8.2–8.7 s, 110 words (`small`, CPU int8, model cached) |
| 2. Plan silences | `node scripts/plan-silence.cjs` | 3.1 s, 13 cuts, 42.42 → 33.53 s, longest pause 0.289 s |
| 3. Create project | `node scripts/create-project.cjs` | 480 px proxy 17.7 s (3.8 MB; the earlier 720 px proxy took 15.2 s, 12.7 MB), source hardlinked, dependencies reused |
| 4. Edit `src/edit.js` | anchors to words or source time | — |
| 5. Validate | `node scripts/validate-edit.cjs` | under 1 s |
| 6. Review in Studio | headed browser tab | proxy only (3.8 MB instead of 463 MB); preview clock ran at real time (0.99–1.00×) |
| — Stills before approval | `npx.cmd remotion still --scale=0.25` | about 11 s per frame from the 4K original |
| 7. Render after approval | `node scripts/export.cjs` (see "Render and verify") | 61 frames at `--scale=0.25`: 21.6 s from the 720 px proxy, 56.8 s from the original; a 10-minute source at 1080p 30 fps: about 3 min + 845 s |

Requirements and first install: see "First run: requirements and install". Tests: `node --test skills/video-editor/tests/video-editor.test.cjs` (14 tests, synthetic audio; 16.1 s here). Every still or render copies `public/` into the bundle (475.7 MB on the sample), so keep unused media out of `public/`.

## Always show the result in Remotion Studio

Every edit step must be visible to the user in Remotion Studio, in a headed, visible browser tab (the harness's integrated browser, tab activated). Open Studio right after creating the project and keep it open. After each change, let hot-reload update the composition, then confirm the new duration and playback in that tab before reporting. Do not report results only as files or a rendered MP4: the Studio preview is the primary deliverable.

### Never render the full video before the user approves

Do **not** run `remotion render` on the whole composition until the user has reviewed the edit in Studio and approved it. A full render of a long or 4K video takes many minutes of CPU, and any later change invalidates it. Iterate in Studio and render only after approval.

Allowed before approval, because each one takes seconds:

- single stills with `remotion still ... --frame=<N> --scale=0.25` to inspect a screen, an overlay or a caption;
- very short clip exports (`--frames=0-30`) when motion itself must be checked;
- measurements taken inside Studio through the browser.

Ask for approval explicitly ("does this edit look right?") and wait. Report the expected render cost before starting one, and never leave a render running while editing, since both compete for CPU.

## 1. Transcribe locally

```powershell
python -m venv "<WORK_DIR>/venv"
"<WORK_DIR>/venv/Scripts/python.exe" -m pip install faster-whisper==1.2.1
"<WORK_DIR>/venv/Scripts/python.exe" <SKILL_DIR>/scripts/transcribe.py "<VIDEO>" "<WORK_DIR>/transcript.json" --language es --cache-dir "<WORK_DIR>/.cache/huggingface"
```

- Verified with `faster-whisper 1.2.1` and `av 18.1.0` on Python 3.11.9. The script extracts mono 16 kHz audio itself and uses `small`, CPU int8, `beam_size=5`, `temperature=0`, `condition_on_previous_text=False`, VAD with 250 ms minimum silence, word timestamps.
- Weights are not downloaded unless `--allow-download` is passed; ask the user first (a few hundred MB). Without it, a missing model fails with faster-whisper's own error.
- Words with `end <= start` are dropped and counted in `discarded_words` instead of aborting the transcript.
- `low_confidence_words` lists words with probability below 0.5 (3 of 110 on the sample; median 0.98). Segment scores are not useful for this: faster-whisper repeats them per 30 s window.
- Re-check a doubtful window with a bigger model without re-transcribing everything: `--model medium --clip 12.0,15.0 --allow-download`.
- Trust the audio over the transcript. A segment over digital silence is a hallucination even when it has text.
- Fix spelling of proper nouns by editing the tokens in `src/captions.js`; keep `transcript.json` as evidence.

## 2. Plan silence cuts (aggressive by default)

Unless the user asks to keep pauses, remove them with the planner; do not hand-pick pauses.

```powershell
node <SKILL_DIR>/scripts/plan-silence.cjs "<VIDEO>" "<WORK_DIR>/transcript.json" "<WORK_DIR>/silence-plan.json"
```

What it does, in one run:

1. `silencedetect` at `-35 dB`, `d=0.25`; a silence open at the end of the file is closed at the duration.
2. Cuts are the silences minus 0.07 s at each edge (a short natural pause), at least 0.2 s long. Clips are their complement; transcript word spans never extend a clip.
3. Joins the audio with the clips, re-detects, and adds what is still silent, until a pass adds nothing (`--max-passes=4`).
4. Audits every word whose span overlaps a cut: the removed slice must read below `--gate=-40` dB on the source. Suspicious words are listed and the exit code is 2.
5. Verifies the joined result: reports `longestPause` and `pausesOverTarget` (target 0.40 s).

Flags: `--noise`, `--min-silence`, `--edge`, `--min-cut`, `--max-passes`, `--target-pause`, `--gate`. Pass `-` instead of the transcript to skip the audit. The output file must not exist; text goes to stderr, a JSON summary to stdout, and the full plan (`clips` in source seconds) to the file. Copy `clips` into `edit.js`.

Silence detection depends on the noise floor. If the audit flags words or pauses survive, measure the floor before moving `--noise` (see lessons).

### Cutting false starts and stumbles

Speakers restart sentences; silence detection never proposes this cut because the words are continuous. Find two similar openings a few seconds apart in the transcript, then split the clip that spans the stumble: exit at a local energy minimum right after the last kept word and re-enter just before the first word of the second take, both below −40 dB in a 20 ms energy profile. Captions need no manual work: the template drops every word that the kept clips do not cover (see "Captions"). Run `validate-edit.cjs` and check that the caption count fell by the stumble's words only (110 → 103 for a 7-word stumble on the sample).

### Optional passes: only when the user asks

These two passes are not part of the default pipeline. Run them only when the user asks for them, and only then. When asked, apply the result yourself: do not stop at a proposal and do not ask for approval of each cut. Make the cuts in `edit.js`, fix the captions, validate, open Remotion Studio on the edited composition and report what was applied. The Studio preview is the user's review; they ask for a change there, or approve the render (see "Never render the full video before the user approves").

**Throat clearings and noises.** Whisper rarely transcribes a throat clearing, and the silence planner keeps it because it is loud. Run, with the current project (or a plan JSON with `clips`, or `-` for the whole file):

```powershell
node <SKILL_DIR>/scripts/detect-noises.cjs "<VIDEO>" "<WORK_DIR>/transcript.json" "<PROJECT_DIR>" "<WORK_DIR>/noises.json"
```

- `candidates`: stretches inside kept clips that no word covers, above `--floor=-45` dB, 0.08–1.2 s, scored by shape (unvoiced, noisy, abrupt onset). `likely` means score ≥ `--min-score=0.6` and a real onset; a region with no energy rise (`tail`) is the end of the previous word, not a noise. Each one has a `cut` widened to the quietest frame within 150 ms, never into a word.
- `wordlessClips`: kept clips that touch no word. `noise` and `quiet` ones can go; `voiced` ones may be speech Whisper missed. Re-transcribe each with `transcribe.py --clip START,END --model medium` (1 s of context on each side) before proposing a cut. If `medium` returns only an outro thank-you phrase over a short sound, it is hallucinating over non-speech: ask the user to listen.
- `suspectWords`: low-probability, unusually long words that may hide a noise.

Measured on a 10-minute, 4K talking head with 121 kept clips: 1.3–1.5 s, 89 regions checked. Its two likely candidates (score 0.91 and 0.84) were the two bursts of the throat clearing an earlier manual scan had located, each isolated in its own clip. It also listed 17 wordless clips; re-transcribing 4 of the 5 voiced ones at `medium` found a first take of a word the transcript had only from 78.6 s (the missed one is at 74.9 s), and two thank-you phrases hallucinated over short sounds. Without the project clips, a third candidate scored 0.61. It is a heuristic: confirm by ear before cutting.

**Script consistency.** Read [references/script-review.md](references/script-review.md) and follow it. It prepares the kept script for your review:

```powershell
node <SKILL_DIR>/scripts/review-script.cjs "<WORK_DIR>/transcript.json" "<PROJECT_DIR>" "<WORK_DIR>/review.json"
```

It writes `review.json` and `review.txt`: kept words numbered by transcript index with source times and pauses, plus hints (repeated phrases within `--window=12` s, restart markers, truncated words, function words left hanging before a pause). You decide what goes; the hints are leads, not verdicts.

#### Procedure (verified on the 10-minute test video)

When the user asks for one or both passes, run them on the current project and follow these steps in order:

1. Run `detect-noises.cjs` and `review-script.cjs` with `<PROJECT_DIR>`, writing into a new folder such as `<WORK_DIR>/optional/` (outputs are never overwritten).
2. Re-transcribe every `voiced` wordless clip, every word you doubt, and the edges of every run the edit already removes (`kept: false` in `review.json`) with `transcribe.py --clip START,END --model medium`, 1 s of context on each side. `small` mishears leftovers: on the test video, three kept words at 417.1–417.5 s were the tail of a sentence the edit had already removed, and the word `medium` places at 424.0 s was attributed to 417.5 s by `small`.
3. Read `review.txt` top to bottom and classify with [references/script-review.md](references/script-review.md).
4. Extract a short WAV for every item that stays doubtful so the user can listen later: `ffmpeg -ss <START-0.5> -t <SECONDS> -i "<VIDEO>" -vn -ac 1 "<WORK_DIR>/optional/listen-<name>.wav"`.
5. Decide, do not ask. Cut every safe item (noise, abandoned or repeated take, leftover of an earlier cut); fix captions (retime, add a word Whisper dropped, spelling). Do not cut parallel phrasing, emphasis or the only take of a sentence. Keep items that stay doubtful after the `medium` re-check and list them in the final report with their WAV paths; do not block on them.
6. Apply each cut by deleting the whole clip when the cut matches a clip (the silence planner already put its edges in silence); otherwise split it as in "Cutting false starts and stumbles". Fix captions in `src/captions.js`, since `keptCaptions` drops the words of removed clips but cannot add a word or move it to where the audio has it.
7. Run `validate-edit.cjs`, check that the caption count fell only by the removed words, and review the joins in Studio. Then start Studio (or reload it) on the edited composition, and finish with the applied-cuts table plus the items kept for listening. Do not render.

## 3. Create and open the project

```powershell
node <SKILL_DIR>/scripts/create-project.cjs "<VIDEO>" "<WORK_DIR>/project" "<WORK_DIR>/transcript.json"
```

| Behavior | Default | Override |
|---|---|---|
| Source in `public/` | hardlink (instant, no extra disk; the file is not modified) | `--copy`; falls back to a copy across drives |
| Proxy `public/proxy.mp4` | created when the short side is above 1080 px or fps above 30: short side 480 px, 30 fps, CRF 28, `-tune fastdecode`, keyframe every second, AAC 128k | `--proxy`, `--no-proxy`, `--proxy-size=<even px>` (for example 720 for a sharper preview) |
| Dependencies | `node_modules` is a junction to one shared install in `<WORK_DIR parent>/.cache/video-editor/remotion-4.0.546`, installed on first use | `--deps=<DIR with node_modules>`, `--no-install`, `--install-timeout=<min>` |

The target directory must not exist. The transcript must belong to this exact source and contain `segments[].words[]` with `word`, `start`, `end` in seconds. Dependencies are resolved before the project folder is created, so a failed install leaves nothing behind. The first shared install uses `npm`; if npm is a broken Corepack shim it retries with `npx --yes npm@10.9.2`; each attempt stops after `--install-timeout` minutes (10) and both real errors are reported. Measured here: the Corepack shim failed with `unable to verify the first certificate` and the fallback did not reach the registry in 5 minutes either, so the first install was not verified end to end; reuse (`--deps` pointing at an installed project) was. If npm cannot validate the registry certificate, use the system's trusted certificates; never disable TLS verification.

Start Studio in a **visible, independent console**, not in a tool-owned background command that ends with the turn:

```powershell
Start-Process -FilePath "powershell" -WorkingDirectory "<WORK_DIR>/project" -ArgumentList '-NoExit','-Command','npx.cmd remotion studio src/index.jsx --port 3333 --no-open' -WindowStyle Normal
```

`npx.cmd` avoids PowerShell's execution-policy problem with `npx.ps1`. Do not start a duplicate server for a running project; pick a free port for a second one. Open `http://localhost:3333/EditedVideo` in the harness's integrated browser and **activate the tab**. Studio plays `proxy.mp4` (check the network entries: only the proxy is requested); renders use the original. Studio listened on all network interfaces here; do not assume the media is private from other network clients.

**Choppy audio in Studio only** (renders are not affected, they wait for every frame): each clip is its own `<Video>` player, and a player that is not premounted starts decoding on the frame of its cut, so chunks near the join are dropped. Clip sequences use `premountFor` (1 s). Measured by hooking `AudioBufferSourceNode.start` while playing the 11-clip sample: without premount, a fresh page (720 px proxy) dropped 4 × 21 ms at joins and a warm run (480 px) lost the whole last clip (6.5 s silent from its join); with premount, a warm run had no holes at joins. The first play after a cache-bypassing reload still dropped 1 s in 11 holes, so play once before judging the audio. Also keep the Studio tab in the foreground (background tabs are throttled), check that the network entries show `proxy.mp4` and not the source, and for a project created before the 480 px default rebuild the proxy in place:

```powershell
ffmpeg -y -i public/source.mp4 -vf "scale=480:-2" -r 30 -c:v libx264 -preset veryfast -tune fastdecode -crf 28 -g 30 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart public/proxy.mp4
```

Use `scale=-2:480` for horizontal video, and add `proxy: "proxy.mp4"` to `edit.js` if the project had no proxy.

## 4. The edit plan (`src/edit.js`)

```js
clips: [{start: 0.366, end: 2.708}, {start: 3.022, end: 5.715}],   // source seconds; order defines the result
zooms: [{word: "documentation", duration: 1.8, scale: 1.2}],
overlays: [{word: "subscribe", duration: 3, type: "cta"}],
screens: [
  {at: "source", start: 1.97, end: 7.2, type: "quote", quote: "…"},
  {word: "create", endWord: "index", type: "list", transition: "slide", title: "…", items: ["…"]},
  {start: 21.3, end: 24.5, type: "split", transition: "wipe", title: "…"},             // output seconds
],
theme: {preset: "neon", primary: "#22d3ee", secondary: "#facc15"}, showSafeZones: true,
```

**Timing anchors.** Items use output seconds by default. Two anchors survive any re-cut without remapping:

| Anchor | Fields | Resolves to |
|---|---|---|
| Source time | `at: "source"`, `start`, `end` | the same moment after the cuts; a time inside a removed part snaps to the nearest kept edge |
| Spoken word | `word` (word or short phrase), `occurrence` (1), `offset` (0 s), and `duration` (3 s) or `endWord`/`endOccurrence` | the start of that word in the kept captions; matching ignores case, accents and punctuation |

A missing word throws in Studio and is an error in the validator.

**Other fields:** `captionsPosition` (`"center"` / `"bottom"`), `captionsMaxWords` (4 vertical, 6 horizontal), `fontFile` (font in `public/`, loaded locally), `joinFadeFrames` (1), `screenSettle` (true), `showSafeZones` (false), `theme`, `proxy`, `music` (written by `music.cjs`), `sfx` (free-standing sound effects), `screenSfx`, `zoomSfx` (default sounds; see "Sound effects").

### Validate before showing

```powershell
node <SKILL_DIR>/scripts/validate-edit.cjs "<WORK_DIR>/project"
```

It resolves the anchors with the project's own `timeline.mjs` and reports errors (exit 1) and warnings:

- errors: clips with `end <= start` or outside the source, items with zero or negative frames, items outside the edit, unknown `type`, missing anchor word, missing proxy, music, sound effect or image file missing from `public/`, `music` without `duration`, unknown theme `preset` or `effect`, theme colors that are not `#rgb`/`#rrggbb`;
- warnings: more than 2 zooms in a 30 s window, more than 2 overlays, overlapping screens, overlapping overlays in one position, overlays under 2.5 s, overlapping clips, theme text below 4.5:1 on its background.

Report its summary line (duration, clips, captions kept, zooms per 30 s, overlays, screens) with each preview.

## 5. Visual strategy (default, approved by the user)

The edit is driven by **zooms and full-screen cards**; small overlays are the exception.

| Element | Budget | Purpose |
|---|---|---|
| `zooms` | at most **2 per 30 s** window of output time | keep a talking head alive |
| `screens` | as many as the content supports | data, definitions, steps, comparisons, the news or person being discussed |
| `overlays` | **1–2 per video** | one truly important highlight; keep a slot free for later requests |

Prefer a screen whenever the speaker names data, a comparison, a definition, a list of steps or a person/company. Use only figures the speaker actually says. Give an overlay at least 2.5 s, and a list or kinetic screen about 0.5 s per item or word plus 1.5 s. Place screens where the speaker is not showing something on camera.

### Zooms

| `mode` | Motion | Default `ramp` |
|---|---|---|
| `punch` (default) | jumps in over 2 frames with an ease-out, eases out at the end | 2 frames |
| `push` | slow push-in with an expo ease-out (`bezier(0.16, 1, 0.3, 1)`) | 0.4 s |

`ramp` (seconds) overrides either. `origin` is the CSS transform-origin: vertical videos default to `"50% 35%"` so the face stays in frame; horizontal to the center. After a full-screen card ends, the picture settles from 1.04 to 1 over 0.35 s (`screenSettle: false` disables it).

### Captions

- Drawn **outside** the zoomed layer, so a punch-in never scales the text. Keep `CaptionLayer` a sibling of the zoomed layer.
- Filtered at runtime by the kept clips: a word stays when a kept clip covers at least `min(0.05 s, word length)` of it. Cutting a stumble removes its words; short words inside a clip stay.
- Pages are grouped by `@remotion/captions` (1.2 s) and split to `captionsMaxWords`.
- Style: `theme.font`, weight 800, black stroke at 7 % of the font size plus shadow, active word in `theme.highlight` with a small spring pop (scale 1.08).

| Video | Position | Size |
|---|---|---|
| Vertical | `top: 56%`, centered on that line, 4 % side margins | `width × 0.0625` |
| Horizontal | `bottom: 7%` | `width × 0.032` |

Captions are hidden while a screen is on. Verify placement by measuring the caption rectangle against `.remotion-studio-composition-container`.

### Audio joins

`joinFadeFrames` (default 1) lowers the volume on the frame on each side of an internal join (0.5 with 1 frame) to soften a residual click. Remotion applies volume per frame, so this is a one-frame dip, not a sample-accurate crossfade; joins must still sit in silence. Measured on a render: the two join frames read exactly 6 dB lower than with `joinFadeFrames: 0` (−54.0 vs −48.0 dB and −75.3 vs −69.1 dB) and every other frame is identical. For platform loudness, normalize the approved render (YouTube and Shorts target about −14 LUFS):

```powershell
ffmpeg -i "<OUTPUT.mp4>" -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:v copy -c:a aac -b:a 192k "<OUTPUT-norm.mp4>"
```

On a 1 s test render this measured −14.2 LUFS integrated afterwards (`ebur128`), with both streams kept.

### Background music (only when the user attaches a song)

```powershell
node <SKILL_DIR>/scripts/music.cjs "<WORK_DIR>/project" "<SONG>" [--voice | --no-voice] [--db=N] [--fade-out=1] [--dry-run]
node <SKILL_DIR>/scripts/music.cjs "<WORK_DIR>/project" --remove
```

- **Length:** the script measures the song and the edit and reports `repeats` and `lastRepeatSeconds`. `Video.jsx` plays the song back to back exactly `ceil(edit / song)` times (Studio shows `Music 1/N`…) and cuts the last repetition at the last frame, never past it, with a `fadeOut` (1 s). Repetitions are computed from `music.duration` at render time, so later cuts need no new music pass.
- **Volume** (`volumeDb`, a gain on the file): **−40 dB** when someone talks, **−5 dB** on a video without voice. Without `--voice`/`--no-voice` the project's captions decide (any word = speech); `--db` is for what the user asks.
- The song is copied to `public/audio/music/` (`export.cjs` copies subfolders of `public/` into the render, but skips media at its top level). `edit.js` is rewritten as JSON, like `cut.cjs`.

Measured on the 212.7 s test edit with a 40.5 s song: 6 repetitions, the last one 10.183 s (5 × 40.5 + 10.183 = 212.683 s). Rendered without speech, the music peaked at −59.7 dB (song peak −19.7 dB − 40), the last second faded to silence and the audio ended on the last frame.

### Sound effects on screens, images and overlays

Free CC0 1.0 effects from creatorassets.com (commercial use, no attribution; the terms forbid scraping that degrades the site, so fetch only the packs you need):

```powershell
node <SKILL_DIR>/scripts/sfx.cjs packs                                  # 31 packs: slug, name, asset count
node <SKILL_DIR>/scripts/sfx.cjs list "<WORK_DIR>/project" swoosh       # each file with length and peak
node <SKILL_DIR>/scripts/sfx.cjs get "<WORK_DIR>/project" swoosh/7 pop/4 bassy-impact/1
```

`list` downloads a pack once into `<WORK_DIR>/.cache/video-editor/sfx/` (about 1 s per file here: swoosh 10 files in 11.4 s). `get` writes `public/audio/sfx/<pack>-<n>.wav` with the leading silence removed (0.03–0.09 s on these files) and the peak normalized to −1 dBFS, so the same `volumeDb` sounds alike for every file. Pick by use and length:

| Moment | Pack | Measured lengths |
|---|---|---|
| a screen enters or leaves, a zoom | `swoosh` (in `7`, out `1`, zoom `6` on the test edit) | 0.56–0.63 s, peaks −11.9 to −23 dB before normalizing |
| an image or overlay pops in | `pop` | 0.55–1.08 s |
| a `breaking` or `stat` screen, a big figure | `bassy-impact` | 0.92–2.57 s |
| `alert`, `notification`, `cta` click | `ding`, `notification`, `click-mouse-click`, `button`, `modern-interface` | not measured |

Use them in `edit.js` at **−15 dB** (the default). `screenSfx` and `zoomSfx` give every screen an entrance and an exit sound and every zoom a whoosh; an item's own `sfx`/`sfxOut` replaces the default and `false` silences it:

```js
screenSfx: {in: "audio/sfx/swoosh-7.wav", out: "audio/sfx/swoosh-1.wav"},   // exit starts 0.3 s before the screen ends
zoomSfx: "audio/sfx/swoosh-6.wav",
screens: [{word: "<WORD>", duration: 3, type: "breaking", sfx: "audio/sfx/bassy-impact-1.wav", sfxOut: false}],
overlays: [{start: 20, end: 24, type: "image", src: "images/person.jpg", sfx: {src: "audio/sfx/pop-4.wav", volumeDb: -15}}],
sfx: [{src: "audio/sfx/swoosh-7.wav", word: "<WORD>", offset: -0.1}],   // free-standing: start | word | at:"source"
```

An item's `sfx` plays at its start; `offset` (s) shifts it (−0.1 lets a whoosh lead a slide) and the start is clamped to 0. Keep effects for screens, zooms and images; not on caption pages. Measured in a render without speech at −8 dB gain: pop and impact peaked at −9.0 dB (−1 − 8) starting on their frame, and the swoosh on a screen at 0.003 s started at 0. All 10 `swoosh` files keep the same peak in a mono downmix (no phase cancellation). An audio-only check (`npx.cmd remotion render ... --codec=wav --frames=0-2099 --props="{\"proxy\":true}"`) rendered 35 s in about 43 s.

### Safe zones

`showSafeZones: true` draws a Studio-only guide; it never appears in stills or renders. Vertical: top 10 %, bottom 20 % and a right column (16 % wide, 40–80 % of the height) where Shorts/Reels/TikTok draw their interface; these are approximations, not measured per platform. Horizontal: a 2.5 % action-safe border. Keep text and badges out of the marked areas.

## 6. Component library (`src/components.jsx`)

Choose a component with `type`; the remaining fields are its props. Items without `type` use `callout` (overlay) or `title` (screen). An unknown `type`, icon or transition throws an error listing the valid names. Sizes scale with the shorter side of the video. Each item has a spring entrance and fades out during its last 0.3 s. Overlays are drawn above screens.

Preview everything in the `Gallery` composition (`/Gallery`, project size) and `GalleryHorizontal` (`/GalleryHorizontal`, 1920×1080), 3 s per item, labelled with its `type`. Let the user pick styles there.

**Overlays** (`position`: `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`). `bottom-*` ends 26 % of the frame height above the bottom (above the captions and the platform UI band). With centered captions (vertical default), the `center-*` row sits just above the caption band instead of on top of it. Measured on 2160×3840: a `center` icon at 28.7–49.2 % of the height and the captions at 54–58 %; a `bottom-center` CTA ending at 73.8 %.

| `type` | Use | Props (default) |
|---|---|---|
| `callout` | Short key-point box | `text`, `color`, `position` (`top-left`) |
| `lowerThird` | Name/title bar that wipes in | `title`, `subtitle`, `color`, `position` (`bottom-left`) |
| `alert` | Info/success/warning/error card; warning and error shake once | `variant` (`info`), `title`, `text`, `icon`, `position` (`top-center`) |
| `notification` | Phone-style push notification | `app` (`Messages`), `title`, `text`, `icon` (`bell`), `time` (`now`), `position` (`top-center`) |
| `icon` | Large icon that pops and floats | `icon` (`star`), `label`, `color`, `size` (18), `position` (`center`) |
| `badge` | Pulsing pill such as "NEW" | `text`, `icon`, `color` (red), `position` (`top-right`) |
| `counter` | Number counting up | `value`, `prefix`, `suffix`, `decimals` (0), `locale` (`es-ES`), `label`, `seconds` (1.2), `position` (`top-center`) |
| `cta` | Subscribe button that is "clicked" | `text` (`Subscribe`), `doneText` (`Subscribed`), `icon` (`bell`), `clickAt` (1 s), `color`, `position` (`bottom-center`) |
| `sidePanel` | Horizontal-first: panel next to the speaker, items revealed one by one | `title`, `items[]`, `icon` (`check`), `side` (`right`), `color` |
| `ticker` | Horizontal-first: news bar with a looping scroll | `label` (`Live`), `text`, `color`, `speed` (1), `position` (`bottom` or `top`) |
| `image` | Photo card next to the speaker (person, company logo, product) that pops in, with a name plate | `src` (file in `public/` or URL), `title`, `subtitle`, `credit`, `shape` (`rounded` or `circle`), `fit` (`cover` for photos, `contain` on white for logos), `size` (34 % of the short side), `color` (border), `position` (`top-right`) |

**Screens** (full frame; speech audio continues). `transition`: `fade` (default, 0.2 s), `slide` (from below), `wipe` (left to right), `zoom` (scales into place); motion transitions take 0.3 s and mirror on exit.

| `type` | Use | Props |
|---|---|---|
| `title` | Title card | `text`, `kicker`, `subtitle` |
| `chapter` | Numbered chapter | `number`, `title`, `subtitle` |
| `quote` | Quotation | `quote`, `author` |
| `list` | Items revealed one by one | `title`, `items[]`, `icon` (`check`), `color` |
| `stat` | Big counting figure | `value`, `prefix`, `suffix`, `decimals`, `locale`, `label`, `note`, `seconds` (1.4) |
| `compare` | Two panels with "VS"; stacked in vertical video | `title`, `left`/`right`: `{label, text, items[], color}` |
| `kinetic` | Words pop in one by one | `text`, `highlight[]` |
| `breaking` | "Breaking news" card with a looping ticker | `label` (`Breaking`), `title`, `text`, `ticker`, `color` |
| `image` | Photo of the news/person or a screenshot, slow Ken Burns push | `src` (file in `public/` or URL), `fit` (`cover`; `contain` adds a blurred fill), `title`, `caption`, `credit`, `kenBurns` (true) |
| `split` | Horizontal-first: text on one half, icon or counting figure on the other | `kicker`, `title`, `text`, `icon` (`bulb`) or `value` + `prefix`/`suffix`/`decimals`/`locale`, `label`, `side` (`left`), `color` |
| `timeline` | Horizontal-first: numbered steps on a growing line | `title`, `steps[]` (strings or `{label, text}`), `color` |
| `endcard` | Closing card: logo, channel name beside it and a small credit line, on a solid plate. For the end of the video | `logo` (`aki-logo.png` in `public/`; `null` draws none), `name` (`Aki Agent`), `tagline`, `background` (`#1d2348`), `font` (Inter) |

In horizontal video, place `sidePanel` opposite the speaker and keep `ticker` to 5–10 s. Large titles (`title`, `chapter`, `breaking`, `stat`, `split`, `kinetic`) shrink so the longest word fits the frame; still check very long titles.

**Icons** (`icon` prop; `<Icon name size color/>` in custom components): `check`, `x`, `alert`, `info`, `question`, `star`, `bolt`, `heart`, `fire`, `arrowRight`, `arrowLeft`, `arrowUp`, `arrowDown`, `trendUp`, `trendDown`, `clock`, `bulb`, `cpu`, `money`, `bell`, `play`, `thumbsUp`, `lock`, `search`. Inline SVG; no packages or network.

**Theme** (`theme` in `edit.js`, or per item to override): `{preset, primary, secondary, tertiary}`. 14 presets, each with its own animated background, type and panel style, all working in vertical and horizontal video: `default`, `neon`, `aurora`, `editorial`, `bold`, `terminal`, `cinematic`, `blueprint`, `pastel`, `brutalist`, `luxe`, `hud`, `comic`, `mono`. `primary` drives kickers, icons and lines (and the background tint in derived presets), `secondary` drives figures, highlighted words and the active caption word, `tertiary` drives the third element. `accent`/`highlight` are aliases of primary/secondary. Text stays readable with any colors (automatic fallbacks; explicit `background`/`text` are kept and the validator warns below 4.5:1). Descriptions, use cases, every variable and how to show the presets: [references/themes.md](references/themes.md). `fontFile` in `edit.js` loads a local font and puts it first in `theme.font` for captions and components.

**Pick the theme before planning screens.** Use a saved or stated preference if there is one. Otherwise suggest 2–3 presets that fit the topic, render the `ThemeSheet` (or `ThemeSheetVertical`) still and show it to the user, and save the choice as a preference afterwards.

To add a component, write it in `components.jsx`, register it in `OVERLAYS` or `SCREENS`, add a sample to `galleryItems` (or `horizontalItems`), and document it here. The validator reads the registries, so new types are recognized automatically.

**Layout check in Studio** (verified): the frame is `.remotion-studio-composition-container`. Pause first; `Shift+ArrowRight`/`Shift+ArrowLeft` move 1 s. Studio keeps neighboring sequences mounted, so only measure elements where `checkVisibility({visibilityProperty:true})` is true, and not on an item's first frame (entrances start off-screen). `@remotion/media` draws video to a canvas, so there is no `<video>` element to inspect; use `performance.getEntriesByType("resource")` to see which file is loaded.

### Images of people, companies and products

Use the `image` overlay while the speaker stays on camera, the `image` screen when the picture should fill the frame. Image overlays count toward the 1–2 overlays per video; more pictures go on `image` screens. Get the file with `find-image.cjs` (Wikimedia Commons, free licenses only) and keep it in `public/images/`; renders should not depend on remote URLs.

```powershell
node <SKILL_DIR>/scripts/find-image.cjs lead "<PERSON>"                          # the image of a Wikipedia article, if it is on Commons
node <SKILL_DIR>/scripts/find-image.cjs search "<COMPANY> logo" --limit=5        # Commons files: size, license, author
node <SKILL_DIR>/scripts/find-image.cjs get "<WORK_DIR>/project" "File:<LOGO>.svg" --name=company-logo
```

1. People: `lead "<Wikipedia article>"` first (`--lang=es` for other wikis). Companies and products: `search "<name> logo"` or the product name; a company article's image is often a building.
2. Prefer a recent, front-facing photo at least 1000 px on its short side; open the file `page` when the description is ambiguous.
3. `get` saves a raster copy (SVG logos come back as PNG) and prints `src` and `credit` (`author / license / Wikimedia Commons`). Put `credit` on the item whenever `attributionRequired` is true (always for CC BY and CC BY-SA).
4. `lead` reports article images that are not on Commons: those are usually non-free (logos, posters); do not use them.
5. Nothing suitable: ask the user for the image (a file they own or have rights to) instead of using an unrelated one. The edit works without it.

Measured here: a person search returned a 1500×1941 CC BY 2.0 portrait; a logo search returned a public-domain SVG, saved as a 20.6 KB PNG at 1200 px. In a 0.25-scale still of the 2160×3840 edit, the portrait card sat exactly in the computed `top-right` box with its name plate below, and the logo (`fit: "contain"`) on white.

## 7. Render and verify

Only render when the edit is ready **and the user has approved the Studio preview**. Use the output location the user requests.

**Export with one command (default 1080p, 30 fps):**

```powershell
node <SKILL_DIR>/scripts/export.cjs "<WORK_DIR>/project" "<OUTPUT.mp4>"
node <SKILL_DIR>/scripts/export.cjs "<WORK_DIR>/project" "<OUTPUT.mp4>" --quality=1440p --fps=60   # only if the user asks
```

Run it in the background and read the `Rendered N/M, time remaining` lines from its stderr to report real progress. It prints a JSON summary (`ok`, size, fps, duration against the expected one, timings). What it does and why each step is there:

1. **Flat render source, once.** Rendering straight from a 4K 60 fps original is slow because every Chrome tab decodes 4K frames: 300 output frames at 1080p 30 fps took 97.9 s from the original and 26.2 s from a light proxy. The script encodes with FFmpeg only the kept clips (213 of 601 s on the test video), already at the output size and fps, in parallel and with D3D11 hardware decoding (falls back to the CPU), joins them, and cuts the audio from the original in one sample-accurate pass. Remotion then reads that file with `--props={"fps":30,"source":"render.mp4","flat":true}` (the template's render overrides). The file is cached in `WORK_DIR/render/<size>@<fps>/` and reused while clips, source, size and fps stay the same; screens, zooms, captions and theme can change without rebuilding it.
2. **No multi-GB copy.** `--public-dir` points to that folder (the render file plus fonts and images of `public/`), so the original is not copied into the bundle.
3. **Render settings.** `--scale` from the short side (0.5 for 1080p from a 2160 px edit; the layout is identical because every size is relative to the composition), `--concurrency` = CPU threads − 2, `--crf=18`, `--x264-preset=veryfast`, AAC 192 kb/s.

| Quality | Use | Cost |
|---|---|---|
| 1080p, 30 fps | default for YouTube, Shorts, Reels, TikTok | test video (212.9 s, 6388 frames, 16 threads, no GPU): flat source about 3 min once, render 845 s (7.6 frames/s), 235 MB; straight from the 4K original the same render extrapolates to about 35 min |
| 1440p (`--quality=1440p`, "2K") | only on request | about 1.8× the pixels of 1080p: tell the user it is slower |
| 2160p (`--quality=2160p`, "4K") | only on request | 4× the pixels of 1080p; the flat source is 4K too |
| 60 fps (`--fps=60`, never above the edit's fps) | only on request | twice the frames: about twice the time |

Hardware encoders (NVENC, QSV, AMF) are not used: on the test machine NVENC needed a newer driver and QSV failed to start, and Remotion encodes with x264 anyway. `--frames=A-B` renders a part for a quick check.

```powershell
ffmpeg -v error -i "<OUTPUT.mp4>" -f null -
```

- `--props="{\"proxy\":true}"` with `npx.cmd remotion render` still renders a fast low-resolution preview from the proxy.
- If downloading Chrome Headless Shell fails with `unable to verify the first certificate`, do not disable TLS. Reuse an installed one: `--browser-executable="<PROJECT_OR_SIBLING>/node_modules/.remotion/chrome-headless-shell/<version>/win64/chrome-headless-shell-win64/chrome-headless-shell.exe"`. With shared dependencies, one browser download serves every project.
- Confirm audio and video streams, the expected duration and a full decode. Visually inspect captions, overlays, zooms and each cut, and listen to the joins: decoding alone cannot validate speech. Report unverified checks; do not call an incomplete render successful.
- Full-quality 4K renders take many minutes (see lessons); run them only after approval, in a visible console, and stop duplicate renders that compete for CPU.
