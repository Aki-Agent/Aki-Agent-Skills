import React from "react";
import {AbsoluteFill, Sequence, Easing, interpolate, spring, useCurrentFrame, useVideoConfig, staticFile, getInputProps, getRemotionEnvironment, delayRender, continueRender, cancelRender} from "remotion";
import {Video} from "@remotion/media";
import {createTikTokStyleCaptions} from "@remotion/captions";
import config from "./edit";
import allCaptions from "./captions";
import {Overlay, Screen, CaptionZone} from "./components";
import {toFrame, buildClips, durationInFrames, frameToSource, keptCaptions, limitPageWords, resolveItems} from "./timeline.mjs";
import {resolveTheme} from "./themes.mjs";

export {durationInFrames};

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
const Clip = ({index, start, length}) => {
  const src = staticFile(useProxySource() ? config.proxy : config.source);
  const volume = (f) => {
    let v = 1;
    if (joinFade > 0 && index > 0 && f < joinFade) v = Math.min(v, (f + 1) / (joinFade + 1));
    if (joinFade > 0 && index < clips.length - 1 && f >= length - joinFade) v = Math.min(v, (length - f) / (joinFade + 1));
    return v;
  };
  return <AbsoluteFill>
    <Video src={src} trimBefore={start} volume={volume} objectFit="cover" style={{width:"100%", height:"100%"}} />
  </AbsoluteFill>;
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
        {clips.map((clip, i) => <Sequence key={i} name={`Clip ${i + 1}`} from={clip.from} durationInFrames={clip.length}>
          <Clip index={i} start={clip.srcFrom} length={clip.length} />
        </Sequence>)}
      </AbsoluteFill>
      <CaptionLayer />
      {screens.map((item, i) => { const length = toFrame(item.end, fps) - toFrame(item.start, fps);
        return <Sequence key={i} name={`Screen ${i + 1}: ${item.type ?? "title"}`} from={toFrame(item.start, fps)} durationInFrames={length}><Screen item={item} duration={length} theme={themeInput} /></Sequence>; })}
      {overlays.map((item, i) => { const length = toFrame(item.end, fps) - toFrame(item.start, fps);
        return <Sequence key={i} name={`Overlay ${i + 1}: ${item.type ?? "callout"}`} from={toFrame(item.start, fps)} durationInFrames={length}><Overlay item={item} duration={length} theme={themeInput} /></Sequence>; })}
      <SafeZones />
    </CaptionZone.Provider>
  </AbsoluteFill>;
};
