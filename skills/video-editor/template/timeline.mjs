// Timeline helpers shared by Video.jsx (Studio/render) and scripts/validate-edit.cjs (Node).
// No imports: this file must load in the browser bundle and in plain Node.

export const toFrame = (seconds, fps) => Math.round(seconds * fps);

// Clips with their frame range on the output timeline. A clip plays source frames
// [srcFrom, srcFrom + length) at output frames [from, from + length).
export const buildClips = (plan) => {
  let from = 0;
  return plan.clips.map((clip) => {
    const srcFrom = toFrame(clip.start, plan.fps), length = toFrame(clip.end, plan.fps) - srcFrom;
    const entry = {...clip, from, srcFrom, length};
    from += length;
    return entry;
  });
};

export const durationInFrames = (plan) => buildClips(plan).reduce((sum, clip) => sum + clip.length, 0);

// Source seconds -> output seconds. A time inside a removed interval snaps to the next kept
// clip (side "start") or to the end of the previous one (side "end").
export const sourceToOutput = (seconds, plan, side = "start") => {
  const clips = buildClips(plan), fps = plan.fps;
  let previousEnd = 0;
  for (const clip of clips) {
    const a = clip.srcFrom / fps, b = (clip.srcFrom + clip.length) / fps;
    if (seconds < a) return side === "start" ? clip.from / fps : previousEnd;
    if (seconds < b || (side === "end" && seconds === b)) return clip.from / fps + (seconds - a);
    previousEnd = (clip.from + clip.length) / fps;
  }
  return previousEnd;
};

// Output frame -> source seconds, using the same frame rounding as the <Video> trims.
export const frameToSource = (frame, clips, fps) => {
  for (const clip of clips) {
    if (frame >= clip.from && frame < clip.from + clip.length) return (clip.srcFrom + frame - clip.from) / fps;
  }
  return null;
};

const normalize = (text) => String(text).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");

// Finds the n-th (1-based) occurrence of a word or short phrase in the timed captions.
export const findWord = (captions, query, occurrence = 1) => {
  const wanted = String(query).split(/\s+/).map(normalize).filter(Boolean);
  if (!wanted.length) throw new Error(`Empty word anchor "${query}"`);
  const tokens = captions.map((c) => normalize(c.text));
  let seen = 0;
  for (let i = 0; i + wanted.length <= tokens.length; i++) {
    if (wanted.every((w, k) => tokens[i + k] === w) && ++seen === occurrence) {
      return {start: captions[i].startMs / 1000, end: captions[i + wanted.length - 1].endMs / 1000};
    }
  }
  throw new Error(`Word anchor "${query}" (occurrence ${occurrence}) not found in captions`);
};

// Items (zooms, overlays, screens) are on the output timeline by default. Two anchors avoid
// remapping by hand after every cut:
//   {at: "source", start, end}                  -> times in source seconds
//   {word: "phrase", occurrence, offset, duration | endWord} -> starts at a spoken word
export const resolveItem = (item, plan, captions = []) => {
  if (item.word !== undefined) {
    const hit = findWord(captions, item.word, item.occurrence ?? 1);
    const start = sourceToOutput(hit.start + (item.offset ?? 0), plan, "start");
    let end;
    if (item.endWord !== undefined) end = sourceToOutput(findWord(captions, item.endWord, item.endOccurrence ?? 1).end, plan, "end");
    else end = start + (item.duration ?? 3);
    return {...item, start, end};
  }
  if (item.at === "source") {
    return {...item, start: sourceToOutput(item.start, plan, "start"), end: sourceToOutput(item.end, plan, "end")};
  }
  return item;
};

export const resolveItems = (items = [], plan, captions = []) => items.map((item) => resolveItem(item, plan, captions));

// Keeps every word that a kept clip overlaps by at least min(0.05 s, word length). A fixed
// threshold would drop short words that sit entirely inside a clip.
export const keptCaptions = (captions, plan) => {
  const fps = plan.fps;
  const ranges = buildClips(plan).map((c) => [c.srcFrom / fps * 1000, (c.srcFrom + c.length) / fps * 1000]);
  return captions.filter((w) => {
    const need = Math.min(50, w.endMs - w.startMs);
    return ranges.some(([a, b]) => Math.min(b, w.endMs) - Math.max(a, w.startMs) >= need);
  });
};

// Splits caption pages longer than `maxWords` tokens into consecutive pages.
export const limitPageWords = (pages, maxWords) => pages.flatMap((page) => {
  if (!maxWords || page.tokens.length <= maxWords) return [page];
  const pageEnd = page.startMs + page.durationMs, out = [];
  for (let i = 0; i < page.tokens.length; i += maxWords) {
    const tokens = page.tokens.slice(i, i + maxWords);
    const next = page.tokens[i + maxWords];
    const startMs = i === 0 ? page.startMs : tokens[0].fromMs;
    out.push({...page, tokens, startMs, durationMs: (next ? next.fromMs : pageEnd) - startMs,
      text: tokens.map((t) => t.text).join("")});
  }
  return out;
});
