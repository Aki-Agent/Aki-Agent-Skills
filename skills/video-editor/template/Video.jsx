import React from "react";
import {AbsoluteFill, Sequence, Easing, interpolate, spring, useCurrentFrame, useVideoConfig, staticFile, getInputProps, getRemotionEnvironment, delayRender, continueRender, cancelRender} from "remotion";
import {Audio, Video} from "@remotion/media";
import {createTikTokStyleCaptions} from "@remotion/captions";
import editConfig from "./edit";
import allCaptions from "./captions";
import previewVersion from "./preview-version";
import {Overlay, Screen, CaptionZone} from "./components";
import {toFrame, buildClips, durationInFrames, frameToSource, keptCaptions, limitPageWords, resolveItems, resolveSounds} from "./timeline.mjs";
import {resolveTheme} from "./themes.mjs";

export {durationInFrames};

// Render overrides (--props), used by scripts/export.cjs: {"fps":30} renders at another frame rate (every
// frame range is built from config.fps); {"source":"render.mp4"} plays another file; {"flat":true} means that
// file is the kept clips already joined at this fps, so each clip starts at its output frame.
const renderProps = getInputProps();
export const config = {...editConfig, ...(renderProps.fps ? {fps:Number(renderProps.fps)} : {}),
  ...(renderProps.source ? {source:renderProps.source} : {}), ...(renderProps.flat ? {flat:true} : {})};

const vertical = config.height > config.width;
const clips = buildClips(config);
// Captions are filtered by the kept clips, so a cut stumble disappears from the text automatically.
const captions = keptCaptions(allCaptions, config);
const zooms = resolveItems(config.zooms, config, captions);
const overlays = resolveItems(config.overlays, config, captions);
const screens = resolveItems(config.screens, config, captions);
const pages = limitPageWords(createTikTokStyleCaptions({captions, combineTokensWithinMilliseconds:1200}).pages,
  config.captionsMaxWords ?? (vertical ? 4 : 6));
const captionsMode = config.captionsPosition ?? (vertical ? "center" : "bottom");

// Brand font for the `endcard` closing screen, loaded from public/ (no network). If the file is
// missing the card falls back to the theme font instead of failing the render.
const END_CARD_FONT = "Inter";
if (config.endCardFont !== false) {
  const handle = delayRender("Loading Inter");
  new FontFace(END_CARD_FONT, `url(${staticFile("fonts/Inter-Variable.ttf")})`).load()
    .then((face) => { document.fonts.add(face); continueRender(handle); })
    .catch(() => continueRender(handle));
}

// Optional local font in public/ (for example "fonts/Inter-Bold.ttf"); no network is used.
const FONT_FAMILY = "EditFont";
if (config.fontFile) {
  const handle = delayRender(`Loading font ${config.fontFile}`);
  new FontFace(FONT_FAMILY, `url(${staticFile(config.fontFile)})`).load()
    .then((face) => { document.fonts.add(face); continueRender(handle); })
    .catch((error) => cancelRender(error));
}
// `theme` in edit.js: {preset, primary, secondary, tertiary, ...overrides}; see themes.mjs.
// Items receive the raw input and resolve it with their own `theme`, so one screen can switch preset.
const baseTheme = resolveTheme(config.theme);
const themeInput = {...config.theme, ...(config.fontFile ? {font:`${FONT_FAMILY}, ${baseTheme.font}`, headingFont:`${FONT_FAMILY}, ${baseTheme.headingFont}`} : {})};
const theme = resolveTheme(themeInput);

// Studio plays the light proxy; renders use the original unless --props='{"proxy":true}' is passed.
const useProxySource = () => Boolean(config.proxy) && (getRemotionEnvironment().isStudio || getInputProps().proxy === true);

// Vertical video: captions sit just below the middle of the frame. Horizontal video: classic
// bottom captions. `captionsPosition` in edit.js overrides the default ("center" | "bottom").
const captionFontSize = config.width * (vertical ? 0.0625 : 0.032);
const captionStyle = {
  position: "absolute", left: "4%", right: "4%", textAlign: "center",
  // Captions sit on the video, not on a screen, so they stay light whatever the theme background is.
  fontFamily: theme.captionFont ?? theme.font, fontWeight: 800, fontSize: captionFontSize, lineHeight: 1.14, color: theme.captionText ?? "#ffffff",
  WebkitTextStroke: `${captionFontSize * 0.07}px #000`, paintOrder: "stroke fill",
  textShadow: "0 2px 6px rgba(0,0,0,.9), 0 0 14px rgba(0,0,0,.6)",
  ...(captionsMode === "center" ? {top: "56%", transform: "translateY(-50%)"} : {bottom: vertical ? "12.5%" : "7%"}),
};

// Captions are drawn outside the zoomed layer, so a punch-in never scales the text.
const CaptionLayer = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const source = frameToSource(frame, clips, fps);
  if (source === null) return null;
  // A full-screen card replaces the picture, so captions are hidden while it is on screen.
  if (screens.some((s) => frame >= toFrame(s.start, fps) && frame < toFrame(s.end, fps))) return null;
  const ms = source * 1000;
  const page = pages.find((p) => ms >= p.startMs && ms < p.startMs + p.durationMs);
  if (!page) return null;
  return <div style={captionStyle}>
    {page.tokens.map((token, i) => {
      const active = ms >= token.fromMs && ms < token.toMs;
      const pop = active ? spring({frame:Math.round((ms - token.fromMs) / 1000 * fps), fps, config:{damping:12, stiffness:220}}) : 0;
      return <React.Fragment key={i}>{i > 0 && " "}<span style={{display:"inline-block", color:active ? theme.captionHighlight ?? theme.highlight : theme.captionText ?? "#ffffff",
        transform:`scale(${1 + 0.08 * pop})`}}>{token.text.trim()}</span></React.Fragment>;
    })}
  </div>;
};

// `joinFadeFrames` (default 1) lowers the volume on the frames next to each internal join to
// soften residual clicks. Remotion applies volume per frame, so the resolution is one frame.
const joinFade = config.joinFadeFrames ?? 1;

// Studio preview audio. Each clip is its own player, so at every join Studio has to seek inside the
// media file; when that seek is not ready it drops 0.1-0.7 s of sound (renders wait for every frame
// and are not affected). Playing one pre-joined audio file removes the seek: on a 62-clip edit the
// dropped audio went from 1600-2043 ms per 30 s to 0-107 ms. `scripts/preview-audio.cjs` writes that
// file; create-project.cjs, cut.cjs and music.cjs rebuild it. Studio mixes voice, music and effects
// into this one player; renders keep the independent layers.
const useSplitAudio = getRemotionEnvironment().isStudio;

const Clip = ({index, start, length}) => {
  const src = staticFile(useProxySource() ? config.proxy : config.source);
  const volume = (f) => {
    let v = 1;
    if (joinFade > 0 && index > 0 && f < joinFade) v = Math.min(v, (f + 1) / (joinFade + 1));
    if (joinFade > 0 && index < clips.length - 1 && f >= length - joinFade) v = Math.min(v, (length - f) / (joinFade + 1));
    return v;
  };
  return <AbsoluteFill>
    <Video src={src} trimBefore={start} muted={useSplitAudio} volume={useSplitAudio ? undefined : volume} objectFit="cover" style={{width:"100%", height:"100%"}} />
  </AbsoluteFill>;
};

// The single continuous track the preview plays. Renders never mount it: they use each clip's audio.
const PreviewAudio = () => {
  if (!useSplitAudio) return null;
  return <Audio src={`${staticFile(config.previewAudio || "preview-audio.wav")}?v=${previewVersion}`} volume={1} />;
};

const gainOf = (db) => Math.pow(10, db / 20);

// Background music (`music` in edit.js, written by scripts/music.cjs): the song repeats back to back
// exactly as many times as the edit needs, and the last repetition is cut at the end of the video.
// Repetitions are computed here from `music.duration`, so later cuts never need a new music pass.
// `volumeDb` is a gain on the file (-40 under speech, -5 without voice); `fadeOut` seconds at the end (1).
const MusicLayer = () => {
  const {fps, durationInFrames: total} = useVideoConfig();
  const music = config.music;
  if (!music) return null;
  const song = Math.max(1, Math.floor(music.duration * fps)), repeats = Math.ceil(total / song);
  const gain = gainOf(music.volumeDb ?? -40), fade = toFrame(music.fadeOut ?? 1, fps);
  return Array.from({length: repeats}, (_, i) => {
    const from = i * song;
    const volume = (f) => gain * (fade > 0 ? Math.min(1, Math.max(0, (total - from - f) / fade)) : 1);
    return <Sequence key={i} name={`Music ${i + 1}/${repeats}`} from={from} durationInFrames={Math.min(song, total - from)} layout="none">
      <Audio src={staticFile(music.src)} volume={volume} />
    </Sequence>;
  });
};

// Sound effects (a file in public/ or {src, volumeDb, offset}). `sfx` on a screen, overlay or zoom plays at
// its start, `sfxOut` on a screen as it leaves; `screenSfx: {in, out}` and `zoomSfx` in edit.js are the
// defaults for every screen and zoom, and `false` on an item silences it. The exit sound starts 0.3 s (the exit
// transition) before the screen ends. Top-level `sfx` items ({src, start | word | at:"source"}) play anywhere.
// `offset` (s) shifts a sound, for example -0.1 so a whoosh leads a slide; `volumeDb` defaults to -15.
const sounds = resolveSounds(config, captions);
const SfxLayer = () => {
  const {fps, durationInFrames: total} = useVideoConfig();
  return sounds.map((s, i) => {
    const from = Math.max(0, toFrame(s.start + (s.offset ?? 0), fps));
    if (from >= total) return null;
    return <Sequence key={i} name={`Sfx ${i + 1}: ${s.src}`} from={from} durationInFrames={Math.min(total - from, toFrame(s.seconds ?? 4, fps))} layout="none">
      <Audio src={staticFile(s.src)} volume={gainOf(s.volumeDb ?? -15)} />
    </Sequence>;
  });
};

// Zoom modes: "punch" (default) jumps in over 2 frames; "push" eases in over `ramp` seconds (0.4).
// `origin` is the CSS transform-origin; vertical videos default to the face area near the top.
const zoomAt = (frame, fps) => {
  let scale = 1, origin = vertical ? "50% 35%" : "50% 50%";
  for (const z of zooms) {
    const a = toFrame(z.start, fps), b = toFrame(z.end, fps);
    if (frame < a || frame >= b) continue;
    const punch = (z.mode ?? "punch") === "punch";
    const wanted = z.ramp !== undefined ? toFrame(z.ramp, fps) : punch ? 2 : toFrame(0.4, fps);
    const ramp = Math.max(1, Math.min(wanted, Math.floor((b - a) / 2)));
    const enter = interpolate(frame, [a, a + ramp], [0, 1], {extrapolateLeft:"clamp", extrapolateRight:"clamp",
      easing: punch ? Easing.out(Easing.cubic) : Easing.bezier(0.16, 1, 0.3, 1)});
    const exit = interpolate(frame, [b - ramp, b], [1, 0], {extrapolateLeft:"clamp", extrapolateRight:"clamp", easing:Easing.inOut(Easing.cubic)});
    scale = 1 + (z.scale - 1) * Math.min(enter, exit);
    origin = z.origin ?? origin;
  }
  return {scale, origin};
};

// After a full-screen card the picture settles from a slight zoom; `screenSettle: false` disables it.
const settleAt = (frame, fps) => {
  if (config.screenSettle === false) return 1;
  const length = Math.round(0.35 * fps);
  for (const s of screens) {
    const b = toFrame(s.end, fps);
    if (frame >= b && frame < b + length) return interpolate(frame, [b, b + length], [1.04, 1], {extrapolateRight:"clamp", easing:Easing.out(Easing.cubic)});
  }
  return 1;
};

// Studio-only guide of the areas covered by Shorts/Reels/TikTok interface (approximate), or the
// 5% action-safe border on horizontal video. Never drawn in renders. Enable with `showSafeZones: true`.
const SafeZones = () => {
  if (!config.showSafeZones || !getRemotionEnvironment().isStudio) return null;
  const zone = {position:"absolute", background:"rgba(255,0,80,.22)", border:"2px dashed rgba(255,0,80,.9)", boxSizing:"border-box",
    color:"#fff", font:`700 ${Math.min(config.width, config.height) * 0.025}px monospace`, padding:6};
  if (!vertical) return <AbsoluteFill style={{border:"2px dashed rgba(255,0,80,.9)", margin:"2.5%", width:"95%", height:"95%", boxSizing:"border-box"}} />;
  return <AbsoluteFill style={{pointerEvents:"none"}}>
    <div style={{...zone, left:0, right:0, top:0, height:"10%"}}>top UI</div>
    <div style={{...zone, left:0, right:0, bottom:0, height:"20%"}}>description / music</div>
    <div style={{...zone, right:0, width:"16%", top:"40%", height:"40%"}}>actions</div>
  </AbsoluteFill>;
};

export const EditedVideo = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const zoom = zoomAt(frame, fps), settle = settleAt(frame, fps);
  return <AbsoluteFill style={{backgroundColor:"#000"}}>
    <CaptionZone.Provider value={captionsMode}>
      <AbsoluteFill style={{transform:`scale(${zoom.scale * settle})`, transformOrigin:zoom.origin}}>
        {/* Premounting loads each clip's player 1 s before its cut; otherwise Studio pauses playback at every join while it buffers. */}
        {clips.map((clip, i) => <Sequence key={i} name={`Clip ${i + 1}`} from={clip.from} durationInFrames={clip.length} premountFor={Math.round(fps)}>
          <Clip index={i} start={config.flat ? clip.from : clip.srcFrom} length={clip.length} />
        </Sequence>)}
      </AbsoluteFill>
      <CaptionLayer />
      {screens.map((item, i) => { const length = toFrame(item.end, fps) - toFrame(item.start, fps);
        return <Sequence key={i} name={`Screen ${i + 1}: ${item.type ?? "title"}`} from={toFrame(item.start, fps)} durationInFrames={length}><Screen item={item} duration={length} theme={themeInput} /></Sequence>; })}
      {overlays.map((item, i) => { const length = toFrame(item.end, fps) - toFrame(item.start, fps);
        return <Sequence key={i} name={`Overlay ${i + 1}: ${item.type ?? "callout"}`} from={toFrame(item.start, fps)} durationInFrames={length}><Overlay item={item} duration={length} theme={themeInput} /></Sequence>; })}
      <PreviewAudio />
      {!useSplitAudio && <MusicLayer />}
      {!useSplitAudio && <SfxLayer />}
      <SafeZones />
    </CaptionZone.Provider>
  </AbsoluteFill>;
};
