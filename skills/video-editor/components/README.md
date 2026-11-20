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

### split-panel

The explanatory half of a `split`, with a title and a list of icon items. It is the only panel with its own opaque background; any other component used as a panel needs `bg`.

| Param | Required | Meaning |
|---|---|---|
| `items` | yes | `[{icon, text, at, tone}]`; `tone` `"good"` or `"bad"` (struck through) |
| `kicker`, `title` | | Heading |

See the `split` example in `SKILL.md`.

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
- Add the type name to `OVERLAY_TYPES` in `scripts/enhance.py` so plans can say `"type": "<name>"`; until then use `"component": "<name>"` with any `type`.
- Render one still before using it in a plan, and check its painted box against the safe zones:

```bash
node scripts/overlay_render.js --jobs still.json
# still.json: [{"html": "components/<name>.html", "params": {...}, "w": 720, "h": 1280, "still": true, "at": 2, "dur": 4, "out": "check.png"}]
```

A `console.error`, an exception or an image that does not load makes the render fail with the message, so a broken component cannot pass as an empty card.
