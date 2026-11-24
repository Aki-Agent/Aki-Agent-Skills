# Components catalog

Every file here is an HTML component that `scripts/enhance.py` renders to a transparent clip and lays over the video. This page is the reference for writing a plan: what each component is for, every param it reads, a JSON event you can copy, and how to change its colors, fonts and position.

Read the "Recipe" section first. It is the order that avoids the mistakes measured on the test recordings.

The ten additional components (`lower-third`, `counter`, `quote`, `steps`, `versus`, `bars`, `kinetic`, `highlight`, `timeline`, `chapter`) were composed on a real 177.2 s vertical cut. A repeat run validated 10 events and reused 10 cached clips; it took 26.88 s total, including 23.55 s encoding. The highlight intentionally covered the speaker's head and produced a 16% overlap warning: inspect each warning in context. The horizontal split has not yet been tested on a real horizontal recording.

## Recipe: from transcript to rendered video

1. **Work on the final cut.** Use the video after `silence` and `script_cut`, and the transcript of *that* video (`final.json`). Timestamps from any other version land on the wrong words.
2. **Pick moments from word timestamps.** For each idea worth showing, find the word that says it in the transcript and use its `start` as the event `start`. An event that starts on the word reads as intentional; half a second early reads as a mistake.
3. **Pick the component** from the "Which component" table below. One idea per event. Do not stack two cards at the same moment.
4. **Check the free space** for the orientation (see "Safe zones"). On a vertical talking head, cards go in the top band; tall components go in a split panel.
5. **Write the plan** (`final.enhance.json`). Copy the example event of each component and change only the text and the times.
6. **Validate**: `python3 scripts/enhance.py final.enhance.json --video final.mp4 --plan-only`. Fix every `ERROR` line. Exit code 2 means the plan was rejected.
7. **Render**: `python3 scripts/enhance.py final.enhance.json --video final.mp4 --ass final.subs.ass --output final_enhanced.mp4 --json report.json`.
8. **Read every `WARNING`.** "covers N% of the head" means move the card up, make it shorter or move it to a split. "covers N% of the subtitle band" means move it up. Re-run: only the changed components are rendered again.
9. **Watch the result**, or at least extract frames at each event (`scripts/edit.py frame`). The checks measure overlap, not taste.

Never invent data. A number on screen must be a number the video says. If a chart or a timeline is illustrative, say so on the component itself (`kicker`, `note` or `tag`).

## Which component

| You want to show | Use | Size on a vertical frame |
|---|---|---|
| A key sentence or idea | `callout` | top band |
| A figure the speaker says ("10 years", "$60.000") | `counter` (animated) or `callout` with `figure` | top band |
| Words that hit hard, no card | `kinetic` | top band |
| What someone said | `quote` | top band, two lines max |
| Who is talking, or where a fact comes from | `lower-third` | above the subtitles |
| A brand, a tag, a call to action | `badge` (`pill`, `banner`, `button`) | anywhere free |
| Two options compared | `versus` | top band |
| A sequence (step 1, 2, 3) | `steps` | **split panel** |
| Amounts compared | `bars` | top band with 2 bars, **split panel** with 3+ |
| Things in time order | `timeline` | top band, up to 4 items |
| "Look here" at something in the footage | `highlight` | wherever the target is |
| A new section or topic | `chapter` | covers the middle on purpose, 1.5-2.5 s |
| A screenshot or image as a card | `screenshot` | below the face, above the subtitles |
| The screen changes to an example image | `broll` | full frame |
| Person on one half, explanation on the other | `split` + `split-panel` (or `steps`, `bars`, `timeline` with `bg`) | half frame |
| Zoom on the speaker | `punch` (not a component) | full frame |
| An app notification ("message received", "download finished") | `toast` | top band |
| A command typed in a terminal, with its output | `terminal` | top band, up to 4 lines; **split panel** with more |
| Several keywords, tools or topics at once | `chips` | top band, or `y` over the chest |
| One share or score ("92% accuracy") | `gauge` | top band |
| Two to four short figures side by side ("16 GB · 3 min · Free") | `kpi-row` | top band |
| Progress of a task ("downloading 72%") | `progress` | top band |
| A chart, a description, a spec sheet, a table or a list **instead of the footage** | a `screen-*` (see "Screens") | full frame, 4-8 s |

## Safe zones

Measured on the 720x1280 test recording (a person filling a vertical frame, subtitles at the bottom):

| Zone | Pixels | Share of height (`top`, `y`) | Put here |
|---|---|---|---|
| Free band above the head | 0-240 | 0-0.19 | `callout`, `counter`, `kinetic`, `quote`, `versus`, `timeline`, 2-bar `bars`, banner `badge` |
| Head | 240-560 | 0.19-0.44 | nothing, except `highlight` pointing at it and full-frame `broll`/`chapter` |
| Neck, chest, hands | 560-1000 | 0.44-0.78 | `screenshot`, `lower-third`, button `badge` |
| Subtitles | 1123-1203 | 0.88-0.94 | nothing |

Every other recording is different: run `enhance` once and read the warnings, which measure the real head and the real subtitle band of that video.

On a horizontal frame the short side is the height, so the same `vmin` sizes are relatively smaller and there is room on the sides. The checks still apply.

Measured on a 1280x720 screen recording with the speaker's webcam in the upper left (skin at x 0.12-0.31, y 0.22-0.55): centered top cards covered 25-50% of the head (`kpi-row` 50%, `terminal` and `progress` 33%, `gauge` 25%). Moving them with `"x": 0.68` cleared every warning. On horizontal, `toast`, `terminal`, `kpi-row` and `progress` default to a narrower width (0.5-0.6 of the frame) so they fit beside a webcam; set `x` to the side the webcam is not on.

## Colors, theme, font and position

Every component reads the same shared settings, so one change applies everywhere. Set them per event in `params`, or once for the whole plan in `defaults`:

```json
{
  "accent": "#ffb020",
  "defaults": {"theme": "dark", "font": "Montserrat, Arial, sans-serif"},
  "events": [
    {"type": "callout", "start": 2.0, "end": 5.0, "params": {"title": "Uses the defaults"}},
    {"type": "callout", "start": 9.0, "end": 12.0, "params": {"title": "Overrides them", "theme": "light", "accent": "#e11d48"}}
  ]
}
```

| Param | What it changes | Default | Example |
|---|---|---|---|
| `accent` | Highlight color: bars, kicker, numbers, borders, icons | `#ffb020` (amber) | `"#3ddc84"` |
| `theme` | Text, muted text and card colors together | `dark` | `"dark"`, `"light"`, `"glass"` |
| `ink` | Main text color | from theme | `"#ffffff"` |
| `muted` | Secondary text color | from theme | `"rgba(255,255,255,.7)"` |
| `card` | Card background (can be semi-transparent) | from theme | `"rgba(10,12,18,.86)"` |
| `bg` | Whole-page background. Leave unset for overlays. **Required** when a component other than `split-panel` is a split panel: choose an opaque color; validation checks only that a value is present | transparent | `"#0a0c12"` |
| `font` | Font family. Use fonts installed on the rendering machine; there is no web font download | `"Segoe UI", Inter, Arial` | `"Georgia, serif"` |
| `top` | Vertical position of the card's top edge, share of the height | per component | `0.015` |
| `x`, `y` | Center point, share of width and height (`badge`, `highlight`) | per component | `0.5`, `0.11` |
| `w` | Width, share of the frame width (`screenshot`) | per component | `0.5` |
| `vars` | Any other CSS variable, by name without `--` | none | `{"good": "#00c853", "bad": "#d50000"}` |

Precedence, from weakest to strongest: component defaults → `theme` → plan `accent` → `defaults` → event `params`.

The themes:

| Theme | Text | Card | Use over |
|---|---|---|---|
| `dark` | white | near-black, 86% opaque | most footage |
| `light` | near-black | white, 94% opaque | dark scenes, or to match a light brand |
| `glass` | white | white at 16% | busy colorful footage where a dark card is too heavy; check readability |

Pick an `accent` that contrasts with the card: amber, green, coral and cyan work on `dark`; on `light` use a darker accent (`#e11d48`, `#2563eb`), because amber on white is hard to read.

Shared animation timing (`vars`): `in` (entry length, default `.5s`) and `out` (exit length, default `.35s`). The renderer sets `dur` to the event length; do not set it by hand.

Icons for any `icon` param: `check`, `x`, `alert`, `chat`, `chart`, `shield`, `bolt`, `clock`, `users`, `briefcase`, `vote`, `flag`, `play`. An unknown name shows no icon (it does not fail).

## Components

Sizes below were measured from 720x1280 stills with test text, shadow included. The examples use generic text; measure the actual text and font before relying on these bounds.

### callout

A card with a kicker, a title, an optional line of text or a big figure.

| Param | Required | Meaning |
|---|---|---|
| `title` | one of `title` / `figure` | Main line, up to two lines |
| `figure` | | Big number or short phrase in accent ("10 years") |
| `kicker` | | Small uppercase label above |
| `text` | | One secondary line |
| `icon` | | Icon next to the kicker |
| `top` | | Default `.04`; use `.015` on a vertical talking head |

```json
{"type": "callout", "start": 0.06, "end": 3.6, "params": {"kicker": "The question", "title": "What happens next?", "icon": "alert", "top": 0.015}}
```

Two title lines end at 214 px, a figure card at 237 px.

### counter

A number that counts up to the figure, with a label. Counts for `count` seconds after the card appears, then holds.

| Param | Required | Meaning |
|---|---|---|
| `to` | yes | Final number |
| `from` | | Start number, default `0` |
| `decimals` | | Decimals shown, default `0` |
| `prefix`, `suffix` | | Text around the number: `"$"`, `" years"`, `"%"` |
| `locale` | | Number format, default `"es-AR"` (`1.500,5`); `"en-US"` gives `1,500.5` |
| `count` | | Seconds the count takes, default `1.2` |
| `kicker`, `label`, `icon` | | Text above and below |

```json
{"type": "counter", "start": 49.6, "end": 52.9, "params": {"kicker": "The warning", "to": 10, "suffix": " years", "label": "until the next milestone", "icon": "clock"}}
```

Ends at 236 px. Keep the event at least `count + 1.5` s long so the final number is readable.

### kinetic

Big words popping in one by one, no card. Good for the hook and for the one phrase that matters.

| Param | Required | Meaning |
|---|---|---|
| `text` | yes | The words, split on spaces |
| `highlight` | | Words (or positions from 0) drawn in accent: `["next?"]` or `[1]` |
| `y` | | Vertical center, default `.11` |
| `size` | | Font size in vmin, default `10` |
| `stagger` | | Seconds between words, default `.18` |
| `upper` | | `false` to keep the original case |

```json
{"type": "kinetic", "start": 0.06, "end": 3.4, "params": {"text": "What comes next?", "highlight": ["next?"], "y": 0.1, "size": 9}}
```

Three words at size 10 span 80-220 px. More than four words wrap to a second line; lower `size` instead.

### quote

What someone said, in italics with a big quote mark and the attribution.

| Param | Required | Meaning |
|---|---|---|
| `text` | yes | The quote, up to about 60 characters on a vertical frame |
| `author`, `role` | | Who said it |

```json
{"type": "quote", "start": 29.9, "end": 33.4, "params": {"text": "A sample quotation", "author": "Example speaker"}}
```

A tested 54-character quote with author ended at 202 px; measure the actual text used. Quote what the video says; do not attribute words to a real person the video does not quote.

### lower-third

A name and role bar sliding in from the side.

| Param | Required | Meaning |
|---|---|---|
| `name` | yes | Name or source |
| `role` | | Second line |
| `icon` | | Icon before the name |
| `side` | | `"left"` (default) or `"right"` |
| `top` | | Default `.70`, which on vertical is above the subtitles |

```json
{"type": "lower-third", "start": 10.44, "end": 15.6, "params": {"name": "Research team", "role": "Example company", "icon": "shield"}}
```

Spans 896-1016 px: over the chest, clear of the head and the subtitles.

### badge

A small pill, banner or button. Can show a logo PNG with alpha.

| Param | Required | Meaning |
|---|---|---|
| `label` | yes | Main text |
| `sub` | | Second line |
| `icon` | | Built-in icon |
| `src` | | Logo image path (PNG with transparency), relative to the plan |
| `variant` | | `"pill"` (default), `"banner"`, `"button"` (accent fill, pulsing) |
| `x`, `y` | | Center point, default `.5`, `.12` |

```json
{"type": "badge", "start": 175.2, "end": 177.15, "params": {"label": "Leave a comment", "icon": "chat", "variant": "button", "y": 0.8}}
```

A banner at `y .11` spans 85-219 px; a button at `y .8` spans 978-1069 px.

### versus

Two options side by side with a VS badge.

| Param | Required | Meaning |
|---|---|---|
| `left`, `right` | yes | Each `{label, text, icon, tone}`; `tone` is `"good"` (green), `"bad"` (red) or omitted (accent) |
| `title` | | Line above both |
| `vs` | | Badge text, default `"VS"` |

```json
{"type": "versus", "start": 106.8, "end": 112.5, "params": {"title": "Which approach?", "left": {"label": "Option A", "text": "First approach", "icon": "x", "tone": "bad"}, "right": {"label": "Option B", "text": "Second approach", "icon": "check", "tone": "good"}}}
```

Ends at 236 px with one line of text per side. Change the good/bad colors with `"vars": {"good": "#00c853", "bad": "#d50000"}`.

### steps

Numbered steps appearing one by one. Tall: 3 steps reach 438 px, so on a vertical frame use it as a split panel.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{text, at}]`; `at` = seconds after the event starts, sync it to the word |
| `title`, `kicker` | | Heading |
| `bg` | for a split panel | Opaque background; also removes the card |

As a split panel (the usual case on vertical):

```json
{"type": "split", "start": 15.72, "end": 26.1, "person": "bottom", "person_y": 0.17,
 "panel": {"component": "steps", "params": {"bg": "#0a0c12", "kicker": "Alignment", "title": "Follow shared values",
   "items": [{"text": "Goals", "at": 2.72}, {"text": "Actions", "at": 3.98}, {"text": "Principles", "at": 7.8}]}}}
```

### bars

Horizontal bars growing in, with values.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{label, value, display, color}]`; `display` replaces the printed value (use `"?"` when there is no real number) |
| `max` | | Value of a full bar, default the largest value |
| `suffix` | | Added after values: `" GB"`, `"%"` |
| `title`, `kicker`, `note` | | Use `note` to say "Illustration, not real data" when it is |
| `bg` | for a split panel | Opaque background |

```json
{"type": "bars", "start": 30.0, "end": 35.0, "params": {"title": "Memory required", "items": [{"label": "Model A", "value": 16}, {"label": "Model B", "value": 64}], "suffix": " GB"}}
```

Two bars with a title end at 218 px; three bars with kicker and note reach 336 px, which needs a split panel on vertical.

### timeline

Milestones on a line, appearing in order.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{date, text, at}]`; `date` is the big label (a year, or "1", "2", "3") |
| `current` | | Position (from 0) drawn in accent as "now" |
| `title` | | Line above |
| `bg` | for a split panel | Opaque background |

```json
{"type": "timeline", "start": 59.8, "end": 71.0, "params": {"title": "Project milestones", "current": 2, "items": [{"date": "1", "text": "First milestone", "at": 0.4}, {"date": "2", "text": "Second milestone", "at": 5.6}, {"date": "3", "text": "Third milestone", "at": 9.3}]}}
```

Three items end at 234 px. Up to 4 items fit a vertical frame, 6 a horizontal one.

### highlight

A ring (or box) drawn around something in the footage, with an arrow and a label.

| Param | Required | Meaning |
|---|---|---|
| `x`, `y` | yes | Center of the target, share of the frame. Measure it on a frame from `scripts/edit.py frame` |
| `r` | | Ring radius as share of the short side, default `.08` |
| `shape` | | `"circle"` (default) or `"box"` with `bw`, `bh` (shares of width/height) |
| `label` | | Text in a tag; without it there is no arrow |
| `from` | | Where the label sits: `"top"` (default), `"bottom"`, `"left"`, `"right"` |

```json
{"type": "highlight", "start": 12.0, "end": 15.0, "params": {"x": 0.7, "y": 0.4, "shape": "box", "bw": 0.2, "bh": 0.1, "label": "This button", "from": "left"}}
```

The label sits `0.2 x short side` away from the target: keep the target at least that far from the frame edge on the label's side.

### chapter

A band wiping across with a number and a title, dimming the footage behind.

| Param | Required | Meaning |
|---|---|---|
| `title` | yes | Section name |
| `number` | | Big number, `"01"` |
| `sub` | | Line under the title |
| `y` | | Band center, default `.5` |
| `dim` | | Darkness behind, 0-1, default `.45`; `0` for none |

```json
{"type": "chapter", "start": 52.9, "end": 55.0, "params": {"number": "01", "title": "The race", "sub": "Keep moving"}}
```

It covers the face on purpose and the check reports it: keep it short (1.5-2.5 s) and put it where the speaker changes topic.

### screenshot

An image card sliding in from the side with a slow push-in.

| Param | Required | Meaning |
|---|---|---|
| `src` | yes | Image path, relative to the plan |
| `caption`, `label` | | Caption under it, tag over it |
| `w`, `top` | | Width and top edge, shares of the frame |

```json
{"type": "screenshot", "start": 89.8, "end": 95.8, "params": {"src": "assets/example.png", "caption": "Example caption", "w": 0.5, "top": 0.585}}
```

At `w .5, top .585` it spans 743-1107 px.

### broll

The screen changes to an image with a slow linear zoom.

| Param | Required | Meaning |
|---|---|---|
| `src` | yes | Image path, relative to the plan |
| `kicker`, `caption` | | Text at the top over a dark gradient |
| `zoom_from`, `zoom_to` | | Scale at start and end, default `1.0` → `1.12` |
| `origin` | | Zoom center, CSS `"50% 30%"` |

```json
{"type": "broll", "start": 52.9, "end": 58.6, "params": {"src": "assets/race.png", "kicker": "The race", "caption": "Keep moving", "zoom_to": 1.12}}
```

Keep it 5-6 s: an opaque full frame is the slowest clip to render (171 frames in 23 s).

Example images: generate them with the agent's built-in image generation, drop them next to the plan and pass them as `src`. Generate at the aspect ratio of the frame (vertical video: tall, horizontal video: wide) — a mismatched ratio makes `cover` crop the subject. The zoom never sits still: it is the point of the component. Any generated image is an illustration, not evidence: say so in `caption`, `tag` or `note`.

### split-panel

The explanatory half of a `split`, with a title and a list of icon items. It is the only panel with its own opaque background; any other component used as a panel needs `bg`.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{icon, text, at, tone}]`; `tone` `"good"` or `"bad"` (struck through) |
| `kicker`, `title` | | Heading |

See the `split` example in `SKILL.md`.

### toast

A phone-style notification that drops in from the top with a small bounce.

| Param | Required | Meaning |
|---|---|---|
| `title` | yes | Bold line |
| `text` | | Body, clamped to two lines |
| `app` | | Small app name at the top left |
| `time` | | Text at the top right, default `"now"` (`""` hides it) |
| `icon` | | App icon on an accent square |
| `top` | | Default `.02` |
| `x`, `w` | | Horizontal center and width, shares of the frame. Default `x .5`; `w .9` on vertical, `.5` on horizontal |

```json
{"type": "toast", "start": 12.0, "end": 15.5, "params": {"app": "Messages", "icon": "chat", "title": "New message", "text": "The model finished downloading"}}
```

Ends at 216 px on vertical with a two-line body. The icon square uses `accent`; the text on it is always dark, so keep a light accent.

### terminal

A terminal window. `cmd` lines are typed character by character with the prompt; output lines appear after them. Show only commands and output the video shows or says.

| Param | Required | Meaning |
|---|---|---|
| `lines` | yes | `[{text, type, at}]`; `type` `"cmd"` (typed), `"out"` (default, muted), `"ok"` (green), `"err"` (red); `at` = seconds after the event starts |
| `title` | | Window title next to the three dots |
| `prompt` | | Default `"$"`; `">"` or `"PS>"` for Windows |
| `cps` | | Typing speed in characters per second, default `28` |
| `x`, `w`, `top` | | Horizontal center (default `.5`), width share (`.9` on vertical, `.6` on horizontal) and top edge (default `.015`) |
| `mono` | | Monospace font list; default tries Cascadia, Consolas, DejaVu Sans Mono, Liberation Mono |
| `bg` | for a split panel | Opaque background |

Without `at`, each line starts when the previous one is done (a `cmd` takes `length / cps` seconds plus 0.35 s). Make the event long enough: the sum of all typing plus 1.5 s. Four short lines end at 259 px on vertical; a command longer than about 30 characters wraps on vertical.

```json
{"type": "terminal", "start": 40.0, "end": 46.0, "params": {"title": "bash", "lines": [{"type": "cmd", "text": "pip install example-package"}, {"text": "Collecting example-package"}, {"type": "ok", "text": "Successfully installed"}]}}
```

Change the colors with `"vars": {"good": "#3ddc84", "bad": "#ff5c5c"}`; the prompt uses `accent`, the window `card`.

### chips

Keyword chips popping in one by one, wrapped and centered.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `["Python", "Docker"]` or `[{text, icon, at, tone}]`; `tone: "accent"` fills one chip with the accent |
| `title` | | Line above the chips |
| `variant` | | `"solid"` (default, `card` background) or `"outline"` (accent border) |
| `top` or `y` | | `top`: top edge, default `.02`. `y`: vertical center instead (for example `.7` over the chest) |

```json
{"type": "chips", "start": 3.0, "end": 7.0, "params": {"title": "Tools in this video", "items": ["Python", {"text": "Docker", "icon": "bolt", "tone": "accent"}, "FFmpeg"]}}
```

Five chips with a title end at 219 px on vertical (two rows). Up to about 7 short words fit the top band.

### gauge

A ring that fills to a share while the number counts up, with a label on the right.

| Param | Required | Meaning |
|---|---|---|
| `value` | yes | The figure |
| `max` | | Value of a full ring, default `100` |
| `suffix` | | Default `"%"`; `""` for none; `"/10"` for a score |
| `display` | | Fixed text in the ring instead of the count |
| `kicker`, `label`, `text`, `icon` | | Text on the right |
| `count` | | Seconds the fill takes, default `1.2` |
| `x`, `top` | | Horizontal center of the card (default `.5`) and top edge (default `.015`) |

```json
{"type": "gauge", "start": 22.0, "end": 25.5, "params": {"kicker": "Accuracy", "icon": "check", "value": 92, "label": "Correct answers"}}
```

Ends at 243 px on vertical. The empty part of the ring is `"vars": {"track": "rgba(255,255,255,.15)"}`.

### kpi-row

Two to four short figures side by side in one card, with separators. Fixed text, no count.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{value, label, icon}]`; `value` is the text shown big (`"16 GB"`) |
| `title` | | Line above the row |
| `highlight` | | Index drawn in accent; the others turn `ink`. Default: all in accent |
| `x`, `w`, `top` | | Horizontal center (default `.5`), width (`.9` on vertical, `.6` on horizontal), top edge (default `.015`) |

```json
{"type": "kpi-row", "start": 30.0, "end": 34.0, "params": {"title": "What you need", "items": [{"value": "16 GB", "label": "RAM"}, {"value": "3 min", "label": "Setup"}, {"value": "Free", "label": "Price"}]}}
```

Ends at 240 px on vertical with icons. The values shrink together when they are long, so four values like `"1.000.000"` still fit one row.

### progress

A labeled bar that fills while the percentage counts up. Striped and moving by default.

| Param | Required | Meaning |
|---|---|---|
| `value` | yes | The figure |
| `max` | | Value of a full bar, default `100` |
| `label`, `kicker`, `icon` | | Text above the bar |
| `suffix`, `display` | | As in `gauge` |
| `fill` | | Seconds the fill takes, default `1.6` |
| `striped` | | `false` for a flat bar |
| `x`, `w`, `top` | | Horizontal center (default `.5`), width (`.88` on vertical, `.55` on horizontal), top edge (default `.015`) |

```json
{"type": "progress", "start": 50.0, "end": 53.5, "params": {"kicker": "Downloading", "label": "Model weights", "value": 72}}
```

Ends at 203 px on vertical.

## Screens

A screen **replaces the footage** for a few seconds while the audio keeps playing: the viewer stops seeing the speaker and sees a chart, a description, a spec sheet, a table or a list. Use them to vary the picture, not on top of it. See the optional visual suggestion guidelines in SKILL.md; the reviewed SFVE script determines which screens are actually used. Each screen lays itself out for the orientation of the frame, so the same event works on a vertical and a horizontal video:

| Screen | Vertical frame | Horizontal frame |
|---|---|---|
| `screen-chart` | heading on top, chart below | heading on the left (36%), chart on the right |
| `screen-donut` | heading, ring, legend (2 columns from 4 items) | heading left, ring and legend right |
| `screen-stats` | 1 column up to 3 figures, 2 columns from 4 | one row up to 4 figures, 3 columns for 5-6 |
| `screen-detail` | image on top, text and details below | image on the left (46%), text on the right |
| `screen-compare` | heading on top, table below | heading left, table right |
| `screen-list` | one column | two columns from 4 items |

How to use them well:

- **4-8 s each**, starting on the word that introduces the content and ending when the speaker moves on. Shorter and nobody reads it; longer and the video feels like slides.
- **Alternate** with the speaker: at most one screen every 20-30 s. Two screens in a row look like a presentation.
- The bottom 13% stays empty (`safe_bottom`) because the **subtitles are burned on top** of the screen. On a video without subtitles set `"safe_bottom": 0.06`.
- A screen fades in and out over 0.3 s (crossfade with the footage). A card (`callout`, `badge`...) can run on top of a screen: screens are on the bottom layer, like `broll`.
- The face check does not apply (it covers the person on purpose), and the subtitle check does not either.
- Never invent data: a chart must use numbers the video says. If it is an illustration, say so in `note`.

Shared params of every screen (on top of the shared settings above):

| Param | What it changes | Default |
|---|---|---|
| `kicker`, `icon`, `title`, `text` | Heading: small accent label, title (up to 2 lines), one or two sentences of description | none |
| `note`, `source` | Footer left and right ("Example data", "Source: ...") | none |
| `bg` | Screen background | `#0b0e15` on `dark`/`glass`, `#f3f4f8` on `light` |
| `panel` | Background of inner tiles, table columns and tracks | white 7% on dark, black 6% on light |
| `pattern` | Background decoration: `"glow"` (accent light in two corners), `"grid"` (moving grid lines), `"none"` | `"glow"` |
| `safe_bottom` | Share of the height kept empty at the bottom for the subtitles | `0.13` |
| `locale` | Number format | `"es-AR"` |

A light branded screen: `{"theme": "light", "accent": "#2563eb", "pattern": "none"}`. A dark screen with your brand color: `{"accent": "#3ddc84", "bg": "#071a12"}`.

Rendering cost: a screen is an opaque full frame, the most expensive clip type (as `broll`). Keep them short and few, especially in the sandbox.

`examples/screens.example.json` uses all six screens and the six overlays above in 70 s. The screens worked unchanged on a vertical and on a horizontal video; on the horizontal one the top cards needed `"x": 0.68` (see "Safe zones"). It is a catalog, not a pacing model: a real video uses far fewer. Measured on a local Windows machine, not the sandbox: 12 clips rendered in 107 s for a 720x1280 30 fps cut and in 190 s for a 1280x720 60 fps cut (twice the frames); the encode took 4-6 s. A re-run after moving 5 cards rendered only those 5 (52.6 s) and reused the 7 others. In both outputs each screen matched its rendered clip on 100% of the pixels at mid-event, and no overlay changed the lower 60% of the frame.

### screen-chart

Bars, columns or a line, with a heading.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{label, value, display, color}]`; `display` replaces the printed value |
| `chart` | | `"bars"` (default, horizontal), `"columns"` (vertical), `"line"` |
| `highlight` | | Index drawn in accent; the others are dimmed. Use it for "the one that matters" |
| `prefix`, `suffix`, `decimals` | | Value format: `"$"`, `" GB"`, `"%"` |
| `max` | | Value of a full bar; default the largest |
| `min` | | Line only: bottom of the scale, default `0` (or the lowest negative value) |

```json
{"type": "screen-chart", "start": 61.2, "end": 67.5, "params": {"kicker": "Memory", "title": "RAM each model needs", "items": [{"label": "Model A", "value": 8}, {"label": "Model B", "value": 16}, {"label": "Model C", "value": 64}], "suffix": " GB", "highlight": 2, "note": "Example data"}}
```

Tested up to 6 items with a two-line title on both orientations. On a line, only the highlighted point (or the last one) shows its value.

### screen-donut

A ring split into shares, a big figure in the hole and a legend.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{label, value, display, color}]`; values are relative, they do not need to add up to 100 |
| `center` | | Big text in the hole; default the share of `highlight` (or of the first item) |
| `center_label` | | Small line under it |
| `highlight` | | Index kept bright; the others are dimmed |
| `palette` | | Colors for items without `color`; default accent, blue, green, red, violet, cyan, pink |
| `suffix`, `decimals` | | Default `"%"`, `0` |

```json
{"type": "screen-donut", "start": 80.0, "end": 86.0, "params": {"kicker": "Market share", "title": "Who uses what", "items": [{"label": "Option A", "value": 52}, {"label": "Option B", "value": 30}, {"label": "Option C", "value": 18}], "center_label": "Option A", "note": "Example data"}}
```

Tested up to 5 items with a two-line title. More than 6 slices are unreadable: group the small ones as "Other".

### screen-stats

Big figures that count up, in tiles.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{value, label, text, icon, prefix, suffix, decimals, display, from, at}]`; `display` shows fixed text instead of a count (`"24/7"`, `"4K"`) |
| `count` | | Seconds each count takes, default `1.2` |

```json
{"type": "screen-stats", "start": 95.0, "end": 101.0, "params": {"kicker": "In numbers", "title": "The project today", "items": [{"value": 1500, "label": "Downloads", "icon": "users"}, {"value": 4.5, "decimals": 1, "suffix": " s", "label": "Answer time"}, {"display": "24/7", "label": "Available"}]}}
```

Tested with 2-6 figures. Use `at` to make each tile appear on the word that says it.

### screen-detail

A description screen: title, a short paragraph, a list of details and an optional image.

| Param | Required | Meaning |
|---|---|---|
| `title` | yes | Name of the thing |
| `text` | | One to three sentences |
| `items` | | `[{label, text, icon, at}]`; with `label` it is a spec row (`"RAM"` … `"32 GB"`), without it a bullet (icon or dot) |
| `src` | | Image path, relative to the plan. Optional: without it the text is centered |
| `caption`, `tag` | | Line under the image, accent label over it |
| `fit` | | `"cover"` (default, fills and crops) or `"contain"` (whole image, for screenshots) |

```json
{"type": "screen-detail", "start": 110.0, "end": 117.0, "params": {"kicker": "The device", "title": "Example mini PC", "text": "A small computer that runs local models.", "src": "assets/example.png", "tag": "Example", "items": [{"label": "RAM", "text": "32 GB"}, {"label": "Storage", "text": "1 TB"}]}}
```

On vertical the text takes the height it needs and the image fills the rest (never below 22% of the height); tested with 5 details, a two-line title and three sentences.

Example images: generate them with the agent's built-in image generation, saved next to the plan (`src` is a path relative to the plan), and pass `src`. Generate at the aspect ratio of the area the image fills (the frame's own ratio for a full-frame image; the image column's ratio for this one — full width, at least 22% of the height, on vertical; 46% of the width on the left, on horizontal). The image zooms slowly over the event (1.0 → 1.06); it never sits still. Any generated image is an illustration, not evidence: tag it in `caption`, `tag` or `note`.

### screen-compare

A table: features in rows, 2-3 options in columns, the recommended column outlined in accent.

| Param | Required | Meaning |
|---|---|---|
| `columns` | yes | `["Cloud", "Local"]`, 2 or 3 names |
| `rows` | yes | `[{label, values, at}]`; each value is `true` (green check), `false` (red cross) or a short text |
| `best` | | Column index outlined in accent |

```json
{"type": "screen-compare", "start": 130.0, "end": 137.0, "params": {"title": "Cloud vs local", "columns": ["Cloud", "Local"], "best": 1, "rows": [{"label": "Privacy", "values": [false, true]}, {"label": "Setup", "values": ["None", "1 hour"]}]}}
```

Tested with 3 columns and 6 rows. Keep text values to one or two words; the check and cross colors are `"vars": {"good": ..., "bad": ...}`.

### screen-list

Numbered key points: a top 5, takeaways, an agenda.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{title, text, icon, at}]`; `text` is an optional second line |
| `numbered` | | Default `true` (01, 02…); `false` shows each item's `icon` (or a check) |

```json
{"type": "screen-list", "start": 150.0, "end": 158.0, "params": {"kicker": "Summary", "title": "Three takeaways", "items": [{"title": "Start small", "text": "One model, one task", "at": 0.5}, {"title": "Measure first", "at": 2.6}, {"title": "Keep it local", "at": 4.9}]}}
```

Tested with 6 items and a two-line title on both orientations.

### scenes/race.html and scenes/trend.html

Not overlays: illustrations rendered once as PNG stills (see `examples/stills.example.json`), then passed as `src` to `broll` or `screenshot`. `race` takes `goal`, `question` and `lanes [{label, letter, color, ahead}]`; `trend` takes `title`, `subtitle`, `tag`, `note`, `points` (0-1 values) and `color`. `trend` labels itself as an illustration by default; keep it that way unless the points are real data from the video.

## Writing a new component

Copy the smallest one that is close (`quote.html` for a card, `kinetic.html` for free text) and keep these rules; each one comes from a defect that happened:

- Link `overlay.css` and `overlay.js`, and put the content in an element with class `life`. That gives the entry/exit animation and reads every shared setting above.
- Size with `vmin`, position with shares of the frame (`calc(var(--top) * 100%)`). A pixel size breaks the same plan on a 4K file.
- Use CSS variables for every color (`var(--accent)`, `var(--ink)`, `var(--muted)`, `var(--card)`), never a fixed color for text or cards, or `theme` stops working.
- Do not put `.life` on an element that has its own `transform` (like `translateY(-50%)` for centering): the exit animation replaces that transform and the element jumps. Wrap it instead, and make the wrapper `position: absolute; inset: 0` so it stays the full frame.
- Read params from `window.OVERLAY.params` in a script placed **after** `overlay.js`. Fill text with `textContent`, never `innerHTML` with a param, so a quote with `<` cannot break the page.
- Animate with CSS animations, `setTimeout` or `requestAnimationFrame` + `performance.now()`. The renderer runs a virtual clock; real time does not pass between frames.
- Keep shadows small (`0 .8vmin 2.4vmin`): shadows are painted pixels and count as covering the face.
- A new **screen** copies `screen-list.html` (the smallest): link `screen.css` after `overlay.css`, load `screen.js` after `overlay.js`, put the content in `.screen.life` with `.head`, `.body` and `.foot`, and use `window.SCREEN.el()` to create text nodes. Lay it out for both `body.portrait` and `body.landscape`, and add its name to `SCREEN_TYPES` in `scripts/enhance.py` (that also puts it on the bottom layer and skips the face check).
- Test both orientations and the longest content you allow (two-line title, the maximum number of items): on the first test pass 6 horizontal bars left the frame, a 5-item donut legend reached the subtitle band and a long description pushed an image caption over the title.
- Add the type name to `OVERLAY_TYPES` in `scripts/enhance.py` so plans can say `"type": "<name>"`; until then use `"component": "<name>"` with any `type`.
- Render one still before using it in a plan, and check its painted box against the safe zones:

```bash
node scripts/overlay_render.js --jobs still.json
# still.json: [{"html": "components/<name>.html", "params": {...}, "w": 720, "h": 1280, "still": true, "at": 2, "dur": 4, "out": "check.png"}]
```

A `console.error`, an exception or an image that does not load makes the render fail with the message, so a broken component cannot pass as an empty card.
