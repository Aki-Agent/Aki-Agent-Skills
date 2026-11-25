import React from "react";
import {AbsoluteFill, Sequence, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {resolveTheme, alpha, onColor, readable, isHexColor, THEMES, THEME_NAMES} from "./themes.mjs";

// Ready-to-use overlays, alerts, icons and full-screen text screens.
// edit.js items are {start, end, type, ...props}; sizes scale with the shorter side of the video.
// Themes live in themes.mjs; `defaultTheme` is the resolved "default" preset.
export const defaultTheme = resolveTheme({});
// Overlays draw on top of the video on their own dark plates, so their text is always light.
const OVERLAY_TEXT = "#ffffff", OVERLAY_MUTED = "#b9c6dd";
const variants = {info:{color:"#3d8bff",icon:"info"}, success:{color:"#22c55e",icon:"check"}, warning:{color:"#f59e0b",icon:"alert"}, error:{color:"#ef4444",icon:"x"}};
const clamp = {extrapolateLeft:"clamp", extrapolateRight:"clamp"};

const useUnit = () => { const {width,height}=useVideoConfig(); return Math.min(width,height)/100; };
const ease = (frame, fps, delay=0, seconds=0.5) => spring({frame:Math.max(0,frame-Math.round(delay*fps)), fps, config:{damping:200}, durationInFrames:Math.max(1,Math.round(seconds*fps))});
const pop = (frame, fps, delay=0) => spring({frame:Math.max(0,frame-Math.round(delay*fps)), fps, config:{damping:9, stiffness:140}});
const rise = (frame, fps, u, delay=0, distance=6) => { const p=ease(frame,fps,delay); return {opacity:p, transform:`translateY(${(1-p)*distance*u}px)`}; };
// Entrance spring (0→1) combined with a fade-out over the last `out` seconds of the item.
const useLife = (duration, out=0.3) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig();
  const outFrames=Math.max(1,Math.min(Math.round(out*fps),Math.floor(duration/2)));
  const enter=ease(frame,fps), exit=interpolate(frame,[duration-outFrames,duration],[1,0],clamp);
  return {frame, fps, enter, exit, life:Math.min(enter,exit)};
};
// Caps a font size so the longest word fits in 84% of the width (ratio ≈ glyph width / font size).
const fitSize = (text, base, width, ratio=0.62) => {
  const longest=Math.max(1,...String(text ?? "").split(/\s+/).map(w=>w.length));
  return Math.min(base, width*0.84/(longest*ratio));
};
const formatNumber = (n, decimals=0, locale="es-ES") => n.toLocaleString(locale,{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
const useCount = (value, delay=0, seconds=1.2) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig();
  return interpolate(frame,[Math.round(delay*fps),Math.round((delay+seconds)*fps)],[0,value],{...clamp,easing:Easing.out(Easing.cubic)});
};

// Caption mode of the edit ("center" | "bottom"), provided by Video.jsx; null in the Gallery.
export const CaptionZone = React.createContext(null);

// Positions: top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, bottom-right.
// "bottom" stays above the caption area (26% from the bottom). With centered captions (vertical
// video), the "center" row sits just above the caption band instead of on top of it.
// Padding is in pixels of the frame height: CSS percentages would be relative to the width.
const Place = ({position="top-left", children}) => {
  const [v,h=v]=position.split("-");
  const {width, height}=useVideoConfig();
  const aboveCaptions = React.useContext(CaptionZone)==="center" && v==="center";
  const axis = s => s==="left"||s==="top" ? "flex-start" : s==="right"||s==="bottom" ? "flex-end" : "center";
  return <AbsoluteFill style={{flexDirection:"row", justifyContent:axis(h), alignItems:aboveCaptions?"flex-end":axis(v), padding:`${height*0.07}px ${width*0.05}px ${height*(aboveCaptions?0.51:0.26)}px`, boxSizing:"border-box"}}>{children}</AbsoluteFill>;
};

// Seamless horizontal scroll: the text repeats, so a long ticker never runs out.
const measureCache = new Map();
const textWidth = (text, font) => {
  const key=font+"|"+text;
  if (!measureCache.has(key)) { const ctx=document.createElement("canvas").getContext("2d"); ctx.font=font; measureCache.set(key, ctx.measureText(text).width); }
  return measureCache.get(key);
};
const Marquee = ({text, font, speed, startX, frame, fps, style}) => {
  const {width}=useVideoConfig();
  const item=`${text}   •   `, period=Math.max(1,textWidth(item,font)), copies=Math.ceil(width/period)+2;
  const travel=frame/fps*speed-startX, x=travel<0 ? -travel : -(travel%period);
  return <div style={{position:"absolute", whiteSpace:"pre", font, transform:`translateX(${x}px)`, ...style}}>{item.repeat(copies)}</div>;
};

// Stroke icons drawn on a 24×24 grid; "circle" draws a centered circle of radius 9.
const ICONS = {
  check:["M20 6 9 17l-5-5"], x:["M18 6 6 18","M6 6l12 12"], alert:["M12 3 2 21h20L12 3z","M12 10v5","M12 18v.01"],
  info:["circle","M12 11v6","M12 7.5v.01"], question:["circle","M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7v.5","M12 17v.01"],
  star:["M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"], bolt:["M13 2 4 14h7l-1 8 9-12h-7l1-8z"],
  heart:["M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"], fire:["M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8 0 4 3 7 7 7z"],
  arrowRight:["M5 12h14","M13 6l6 6-6 6"], arrowLeft:["M19 12H5","M11 6l-6 6 6 6"], arrowUp:["M12 19V5","M6 11l6-6 6 6"], arrowDown:["M12 5v14","M6 13l6 6 6-6"],
  trendUp:["M3 17l6-6 4 4 8-8","M15 7h6v6"], trendDown:["M3 7l6 6 4-4 8 8","M15 17h6v-6"], clock:["circle","M12 7v5l3 3"],
  bulb:["M9 18h6","M10 21h4","M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"],
  cpu:["M7 7h10v10H7z","M9 2v3","M15 2v3","M9 19v3","M15 19v3","M2 9h3","M2 15h3","M19 9h3","M19 15h3"],
  money:["M12 2v20","M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"], bell:["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9","M10 21a2 2 0 0 0 4 0"],
  play:["M7 4v16l13-8z"], thumbsUp:["M7 10v11","M7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.1 21H7","M7 10H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"],
  lock:["M5 11h14v10H5z","M8 11V7a4 4 0 0 1 8 0v4"], search:["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z","M20 20l-4.8-4.8"],
};
export const ICON_NAMES = Object.keys(ICONS);
export const Icon = ({name, size, color="currentColor", stroke=2.2}) => {
  const paths=ICONS[name];
  if (!paths) throw new Error(`Unknown icon "${name}". Available: ${ICON_NAMES.join(", ")}`);
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0}}>
    {paths.map((d,i)=>d==="circle" ? <circle key={i} cx="12" cy="12" r="9"/> : <path key={i} d={d}/>)}
  </svg>;
};

// ---------- Overlays (drawn over the video) ----------
const Callout = ({text, position="top-left", color, theme, duration}) => {
  const {life}=useLife(duration); const u=useUnit();
  return <Place position={position}><div style={{background:color??theme.card, color:theme.text, font:`bold ${u*4.2}px ${theme.font}`, padding:`${u*2}px ${u*3}px`, borderRadius:u*1.6, borderLeft:`${u*0.8}px solid ${theme.accent}`, boxShadow:"0 8px 24px rgba(0,0,0,.35)", maxWidth:"80%", opacity:life, transform:`translateX(${(1-life)*-u*8}px)`}}>{text}</div></Place>;
};

const LowerThird = ({title, subtitle, position="bottom-left", color, theme, duration}) => {
  const {frame, fps, exit}=useLife(duration); const u=useUnit();
  const a=ease(frame,fps), b=ease(frame,fps,0.2);
  return <Place position={position}><div style={{display:"flex", flexDirection:"column", alignItems:"flex-start", opacity:exit, fontFamily:theme.font}}>
    <div style={{background:color??theme.accent, color:"#fff", fontWeight:800, fontSize:u*5, padding:`${u*1.4}px ${u*2.6}px`, clipPath:`inset(0 ${(1-a)*100}% 0 0)`}}>{title}</div>
    {subtitle && <div style={{background:"rgba(0,0,0,.78)", color:OVERLAY_TEXT, fontWeight:600, fontSize:u*3.4, padding:`${u*1}px ${u*2.6}px`, clipPath:`inset(0 ${(1-b)*100}% 0 0)`}}>{subtitle}</div>}
  </div></Place>;
};

const Alert = ({variant="info", title, text, icon, position="top-center", theme, duration}) => {
  const {frame, fps, enter, exit}=useLife(duration); const u=useUnit();
  const v=variants[variant] ?? variants.info;
  const shake=variant==="error"||variant==="warning" ? Math.sin(frame*1.3)*u*0.7*interpolate(frame,[fps*0.4,fps*1],[1,0],clamp)*(frame>fps*0.4?1:0) : 0;
  return <Place position={position}><div style={{display:"flex", alignItems:"center", gap:u*2.4, width:"88%", boxSizing:"border-box", background:"rgba(10,15,30,.92)", borderLeft:`${u*1}px solid ${v.color}`, borderRadius:u*2, padding:`${u*2.4}px ${u*3}px`, boxShadow:"0 10px 30px rgba(0,0,0,.45)", fontFamily:theme.font, color:OVERLAY_TEXT, opacity:exit, transform:`translate(${shake}px, ${(1-enter)*-u*18}px)`}}>
    <div style={{background:v.color, borderRadius:"50%", padding:u*1.4}}><Icon name={icon??v.icon} size={u*6} color="#fff" stroke={2.6}/></div>
    <div style={{textAlign:"left"}}>
      {title && <div style={{fontWeight:800, fontSize:u*4.4}}>{title}</div>}
      {text && <div style={{fontSize:u*3.4, color:OVERLAY_MUTED, marginTop:u*0.6}}>{text}</div>}
    </div>
  </div></Place>;
};

const Notification = ({app="Messages", title, text, icon="bell", time="now", position="top-center", theme, duration}) => {
  const {enter, exit}=useLife(duration); const u=useUnit();
  return <Place position={position}><div style={{width:"90%", boxSizing:"border-box", background:"rgba(250,250,252,.97)", color:"#111", borderRadius:u*3.6, padding:`${u*2.4}px ${u*3}px`, boxShadow:"0 12px 34px rgba(0,0,0,.4)", fontFamily:theme.font, textAlign:"left", opacity:exit, transform:`translateY(${(1-enter)*-u*30}px)`}}>
    <div style={{display:"flex", alignItems:"center", gap:u*1.4, fontSize:u*3, color:"#555"}}>
      <div style={{background:theme.accent, borderRadius:u*1, padding:u*0.6}}><Icon name={icon} size={u*3.6} color="#fff"/></div>
      <span style={{fontWeight:700, textTransform:"uppercase", letterSpacing:u*0.1}}>{app}</span><span style={{marginLeft:"auto"}}>{time}</span>
    </div>
    {title && <div style={{fontWeight:800, fontSize:u*4.2, marginTop:u*1.4}}>{title}</div>}
    {text && <div style={{fontSize:u*3.6, marginTop:u*0.6, color:"#333"}}>{text}</div>}
  </div></Place>;
};

const IconPop = ({icon="star", label, color, size=18, position="center", theme, duration}) => {
  const {frame, fps, exit}=useLife(duration); const u=useUnit();
  const s=pop(frame,fps), float=Math.sin(frame/fps*3)*u*0.8;
  return <Place position={position}><div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:u*2, opacity:exit, transform:`translateY(${float}px) scale(${s})`}}>
    <div style={{background:color??theme.accent, borderRadius:"50%", padding:u*size*0.22, boxShadow:"0 10px 30px rgba(0,0,0,.4)"}}><Icon name={icon} size={u*size} color="#fff" stroke={2.4}/></div>
    {label && <div style={{background:"rgba(0,0,0,.75)", color:OVERLAY_TEXT, font:`800 ${u*4.4}px ${theme.font}`, padding:`${u*1}px ${u*2.4}px`, borderRadius:u*1.4}}>{label}</div>}
  </div></Place>;
};

const Badge = ({text, icon, color, position="top-right", theme, duration}) => {
  const {frame, fps, exit}=useLife(duration); const u=useUnit();
  const s=pop(frame,fps)*(1+0.03*Math.sin(frame/fps*6));
  return <Place position={position}><div style={{display:"flex", alignItems:"center", gap:u*1.2, background:color??"#ef4444", color:"#fff", font:`900 ${u*3.8}px ${theme.font}`, textTransform:"uppercase", letterSpacing:u*0.2, padding:`${u*1.2}px ${u*2.6}px`, borderRadius:u*10, boxShadow:"0 6px 18px rgba(0,0,0,.35)", opacity:exit, transform:`scale(${s})`}}>
    {icon && <Icon name={icon} size={u*4.4} color="#fff" stroke={2.6}/>}{text}
  </div></Place>;
};

const Counter = ({value, prefix="", suffix="", label, decimals=0, locale, seconds=1.2, position="top-center", theme, duration}) => {
  const {life}=useLife(duration); const u=useUnit(); const n=useCount(value,0.15,seconds);
  return <Place position={position}><div style={{background:"rgba(10,15,30,.88)", borderRadius:u*2.4, padding:`${u*2}px ${u*4}px`, textAlign:"center", fontFamily:theme.font, opacity:life, transform:`scale(${0.85+0.15*life})`}}>
    <div style={{color:theme.highlight, fontWeight:900, fontSize:u*11, lineHeight:1}}>{prefix}{formatNumber(n,decimals,locale)}{suffix}</div>
    {label && <div style={{color:OVERLAY_TEXT, fontWeight:700, fontSize:u*3.6, marginTop:u*1}}>{label}</div>}
  </div></Place>;
};

const Cta = ({text="Subscribe", doneText="Subscribed", icon="bell", clickAt=1, color="#ef4444", position="bottom-center", theme, duration}) => {
  const {frame, fps, life}=useLife(duration); const u=useUnit();
  const click=Math.round(clickAt*fps), done=frame>=click;
  const press=interpolate(frame,[click-4,click,click+6],[1,0.9,1],clamp);
  return <Place position={position}><div style={{display:"flex", alignItems:"center", gap:u*1.6, background:done?"#3a3f4b":color, color:"#fff", font:`800 ${u*5}px ${theme.font}`, padding:`${u*2}px ${u*4.4}px`, borderRadius:u*10, boxShadow:"0 10px 26px rgba(0,0,0,.4)", opacity:life, transform:`scale(${press*(0.8+0.2*life)})`}}>
    <Icon name={done?"check":icon} size={u*5.4} color="#fff" stroke={2.6}/>{done?doneText:text}
  </div></Place>;
};

// Designed for horizontal video: a side panel next to the speaker and a news ticker.
const SidePanel = ({title, items=[], icon="check", side="right", color, theme, duration}) => {
  const {frame, fps, enter, exit}=useLife(duration); const u=useUnit();
  const dir=side==="left"?-1:1, c=color??theme.accent;
  const step=Math.min(0.45,Math.max(0.15,(duration/fps-1.2)/Math.max(1,items.length)));
  return <AbsoluteFill style={{flexDirection:"row", justifyContent:side==="left"?"flex-start":"flex-end", alignItems:"center", padding:"5% 4% 22%", boxSizing:"border-box"}}>
    <div style={{width:"34%", minWidth:u*40, background:"rgba(10,15,30,.86)", borderRadius:u*2.4, borderTop:`${u*0.8}px solid ${c}`, padding:u*3.4, boxSizing:"border-box", fontFamily:theme.font, color:OVERLAY_TEXT, textAlign:"left", boxShadow:"0 10px 30px rgba(0,0,0,.4)", opacity:exit, transform:`translateX(${(1-enter)*dir*u*40}px)`}}>
      {title && <div style={{fontWeight:800, fontSize:u*5.4, marginBottom:u*2.4}}>{title}</div>}
      {items.map((item,i)=>{ const p=ease(frame,fps,0.3+i*step); return <div key={i} style={{display:"flex", alignItems:"center", gap:u*1.8, fontSize:u*3.8, fontWeight:700, marginTop:u*1.8, opacity:p, transform:`translateX(${(1-p)*dir*u*6}px)`}}>
        <div style={{background:c, borderRadius:"50%", padding:u*0.8, flexShrink:0}}><Icon name={icon} size={u*3.4} color="#fff" stroke={2.8}/></div>{item}
      </div>; })}
    </div>
  </AbsoluteFill>;
};

const Ticker = ({label="Live", text="", color="#e11d2e", speed=1, position="bottom", theme, duration}) => {
  const {frame, fps, enter, exit}=useLife(duration); const u=useUnit(); const {width}=useVideoConfig();
  const top=position==="top";
  return <div style={{position:"absolute", left:0, right:0, [top?"top":"bottom"]:"3%", height:u*7.5, display:"flex", fontFamily:theme.font, opacity:exit, transform:`translateY(${(1-enter)*(top?-1:1)*u*12}px)`}}>
    <div style={{background:color, color:"#fff", fontWeight:900, fontSize:u*3.6, textTransform:"uppercase", letterSpacing:u*0.3, padding:`0 ${u*2.4}px`, display:"flex", alignItems:"center", gap:u*1.2}}>
      <div style={{width:u*1.6, height:u*1.6, borderRadius:"50%", background:"#fff", opacity:0.5+0.5*Math.sin(frame/fps*8)}}/>{label}
    </div>
    <div style={{flex:1, background:"rgba(0,0,0,.78)", overflow:"hidden", position:"relative", display:"flex", alignItems:"center"}}>
      <Marquee text={text} font={`700 ${u*3.6}px ${theme.font}`} speed={u*25*speed} startX={width*0.6} frame={frame} fps={fps} style={{color:OVERLAY_TEXT}}/>
    </div>
  </div>;
};

// Photo card next to the speaker: a person, a company logo, a product. `src` is a file in public/
// (scripts/find-image.cjs saves to images/) or a data:/http(s): URL; `fit` "cover" (photos) or "contain" (logos).
const ImageCard = ({src, title, subtitle, credit, shape="rounded", fit="cover", size=34, position="top-right", color, theme, duration}) => {
  const {frame, fps, exit}=useLife(duration); const u=useUnit();
  if (!src) throw new Error(`Overlay "image" needs a src (file in public/ or URL)`);
  const url=/^(https?:|data:)/.test(src) ? src : staticFile(src);
  const s=pop(frame,fps), c=color??theme.accent, side=u*size, round=shape==="circle";
  return <Place position={position}><div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:u*1.6, opacity:exit, transform:`scale(${s})`}}>
    <div style={{width:side, height:side, borderRadius:round?"50%":u*2.4, overflow:"hidden", border:`${u*0.7}px solid ${c}`, background:fit==="contain"?"#ffffff":"#000", boxShadow:"0 12px 32px rgba(0,0,0,.45)", position:"relative"}}>
      <Img src={url} style={{width:"100%", height:"100%", objectFit:fit, padding:fit==="contain"?u*2:0, boxSizing:"border-box", transform:`scale(${interpolate(frame,[0,Math.max(1,duration)],[1,1.06],clamp)})`}}/>
      {credit && <div style={{position:"absolute", left:0, right:0, bottom:0, padding:`${u*0.5}px ${u*1}px`, background:"rgba(0,0,0,.55)", color:"rgba(255,255,255,.85)", font:`600 ${u*1.9}px ${theme.font}`, textAlign:"center", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{credit}</div>}
    </div>
    {(title || subtitle) && <div style={{background:"rgba(10,15,30,.88)", borderRadius:u*1.4, padding:`${u*1}px ${u*2.4}px`, textAlign:"center", fontFamily:theme.font, color:OVERLAY_TEXT, maxWidth:side*1.4, ...rise(frame,fps,u,0.15,3)}}>
      {title && <div style={{fontWeight:800, fontSize:u*4.2}}>{title}</div>}
      {subtitle && <div style={{color:OVERLAY_MUTED, fontWeight:600, fontSize:u*3, marginTop:u*0.4}}>{subtitle}</div>}
    </div>}
  </div></Place>;
};

export const OVERLAYS = {callout:Callout, lowerThird:LowerThird, alert:Alert, notification:Notification, icon:IconPop, badge:Badge, counter:Counter, cta:Cta, sidePanel:SidePanel, ticker:Ticker, image:ImageCard};

// ---------- Full-screen screens (replace the picture; speech audio continues) ----------
// Shared theme styling: panels (list rows, compare panels), headings and shadows.
const shadowOf = (theme, u) => ({soft:`0 ${u*0.8}px ${u*2.6}px rgba(0,0,0,.28)`, glow:`0 0 ${u*2.4}px ${alpha(theme.primary,0.45)}`, hard:`${u*0.9}px ${u*0.9}px 0 ${theme.line}`}[theme.shadow] ?? "none");
const panel = (theme, u) => ({background:theme.surface, color:theme.surfaceText ?? theme.text, borderRadius:u*2*theme.radius, border:theme.border ? `${u*theme.border}px solid ${theme.line}` : "none", boxShadow:shadowOf(theme,u), boxSizing:"border-box"});
const heading = (theme) => ({fontFamily:theme.headingFont, textTransform:theme.uppercase ? "uppercase" : undefined, letterSpacing:theme.uppercase ? "0.02em" : undefined});
// Uppercase heavy type is wider; fitSize uses this to keep the longest word inside the frame.
const wide = (theme) => (theme.uppercase ? 1.25 : 1);

// Animated background of a screen, chosen by theme.effect. Everything is sized from the short side
// (u = 1 % of it) or in percentages, so the same effect works in vertical and horizontal video.
const Effect = ({theme}) => {
  const frame=useCurrentFrame(); const {fps, width, height}=useVideoConfig(); const u=useUnit();
  const t=frame/fps, vertical=height>width, big=Math.max(width,height);
  const fill={position:"absolute", inset:0, pointerEvents:"none"};
  const abs=(style) => ({position:"absolute", pointerEvents:"none", ...style});
  const {primary:p, secondary:s, tertiary:q}=theme;
  switch (theme.effect) {
    case "none": return null;
    case "gradient": return <div style={{...fill, background:`radial-gradient(ellipse at 50% 0%, ${alpha(p,0.3)}, transparent 62%)`}}/>;
    case "grid": return <div style={fill}>
      <div style={abs({left:"50%", top:"36%", width:big*0.8, height:big*0.8, transform:"translate(-50%,-50%)", background:`radial-gradient(circle, ${alpha(s,0.22)}, transparent 62%)`})}/>
      <div style={abs({left:"-60%", right:"-60%", bottom:0, height:"52%", transformOrigin:"50% 100%", transform:`perspective(${u*45}px) rotateX(64deg)`,
        backgroundImage:`linear-gradient(${alpha(p,0.6)} ${u*0.18}px, transparent ${u*0.18}px), linear-gradient(90deg, ${alpha(p,0.6)} ${u*0.18}px, transparent ${u*0.18}px)`,
        backgroundSize:`${u*9}px ${u*9}px`, backgroundPosition:`0 ${(t*u*7)%(u*9)}px`, WebkitMaskImage:"linear-gradient(transparent, #000 75%)"})}/>
      {Array.from({length:16}, (_, i) => { const x=(i*37%100), y=((i*53+t*6*(1+i%3))%110)-5; return <div key={i} style={abs({left:`${x}%`, bottom:`${y}%`, width:u*0.5, height:u*0.5, borderRadius:"50%", background:s, opacity:0.35+0.3*Math.sin(t*2+i), boxShadow:`0 0 ${u}px ${s}`})}/>; })}
    </div>;
    case "aurora": return <div style={fill}>
      {[[p,0.2,0.22,0],[s,0.82,0.38,2],[q,0.45,0.88,4]].map(([c,x,y,ph],i) => <div key={i} style={abs({width:big*0.8, height:big*0.8, borderRadius:"50%",
        left:`${(x+0.08*Math.sin(t*0.35+ph))*100}%`, top:`${(y+0.06*Math.cos(t*0.3+ph))*100}%`, transform:"translate(-50%,-50%)",
        background:`radial-gradient(circle, ${alpha(c,0.5)}, transparent 64%)`})}/>)}
    </div>;
    case "paper": { const r=ease(frame,fps,0,0.8); return <div style={fill}>
      <div style={{...fill, backgroundImage:`repeating-linear-gradient(0deg, ${alpha(q,0.05)} 0 ${u*0.12}px, transparent ${u*0.12}px ${u*5}px)`}}/>
      <div style={abs({left:"6%", right:"6%", top:"5%", height:u*0.9, borderTop:`${u*0.5}px solid ${p}`, borderBottom:`${u*0.15}px solid ${p}`, transform:`scaleX(${r})`, transformOrigin:"left"})}/>
      <div style={abs({left:"6%", right:"6%", bottom:"5%", borderTop:`${u*0.15}px solid ${alpha(q,0.5)}`, transform:`scaleX(${r})`, transformOrigin:"right"})}/>
    </div>; }
    case "blocks": { const a=ease(frame,fps,0,0.6), b=ease(frame,fps,0.15,0.6); return <div style={fill}>
      <div style={abs({right:0, top:0, width:vertical?"58%":"30%", height:vertical?"11%":"26%", background:p, transform:`translateX(${(1-a)*100}%)`})}/>
      <div style={abs({left:0, bottom:0, width:vertical?"42%":"22%", height:vertical?"7%":"16%", background:s, transform:`translateY(${(1-b)*100}%)`})}/>
      <div style={abs({left:vertical?"42%":"22%", bottom:0, width:u*7, height:u*7, background:q, transform:`scale(${b})`, transformOrigin:"0 100%"})}/>
    </div>; }
    case "scanlines": return <div style={fill}>
      <div style={abs({left:0, right:0, height:"14%", top:`${((t*0.22)%1.3-0.15)*100}%`, background:`linear-gradient(transparent, ${alpha(p,0.1)}, transparent)`})}/>
      <div style={{...fill, background:alpha(p,0.035+0.015*Math.sin(t*23))}}/>
      <div style={{...fill, backgroundImage:`repeating-linear-gradient(0deg, rgba(0,0,0,.32) 0 ${u*0.18}px, transparent ${u*0.18}px ${u*0.42}px)`}}/>
      <div style={{...fill, background:"radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.7))"}}/>
    </div>;
    case "spotlight": { const x=50+16*Math.sin(t*0.4); return <div style={fill}>
      <div style={{...fill, background:`radial-gradient(ellipse ${vertical?"85% 42%":"42% 75%"} at ${x}% 45%, ${alpha(q,0.24)}, transparent 72%)`}}/>
      <div style={{...fill, background:`radial-gradient(ellipse at 50% 120%, ${alpha(p,0.25)}, transparent 55%)`}}/>
      <div style={abs({left:0, right:0, top:0, height:vertical?"5%":"9%", background:"#000"})}/>
      <div style={abs({left:0, right:0, bottom:0, height:vertical?"5%":"9%", background:"#000"})}/>
    </div>; }
    case "blueprint": return <div style={fill}>
      <div style={{...fill, backgroundImage:[q,q,q,q].map((c,i) => `linear-gradient(${i%2?"90deg, ":""}${alpha(c,i<2?0.1:0.24)} ${u*0.1}px, transparent ${u*0.1}px)`).join(", "),
        backgroundSize:`${u*4}px ${u*4}px, ${u*4}px ${u*4}px, ${u*20}px ${u*20}px, ${u*20}px ${u*20}px`}}/>
      <div style={abs({right:"4%", bottom:"3.5%", border:`${u*0.2}px solid ${alpha(q,0.7)}`, padding:`${u*0.7}px ${u*1.6}px`, font:`${u*2}px ${theme.headingFont}`, color:readable([q], theme.background, theme.muted), letterSpacing:u*0.2})}>REV A · 1:1</div>
      <div style={abs({left:"4%", top:"4%", width:`${ease(frame,fps,0,0.9)*30}%`, borderTop:`${u*0.2}px dashed ${alpha(s,0.8)}`})}/>
    </div>;
    case "blobs": return <div style={fill}>
      {[[p,0.1,0.16,0,0.34],[s,0.9,0.24,1.5,0.28],[q,0.82,0.88,3,0.38],[p,0.14,0.84,4.5,0.2]].map(([c,x,y,ph,size],i) => <div key={i} style={abs({width:big*size, height:big*size, borderRadius:"50%",
        left:`${(x+0.025*Math.sin(t*0.8+ph))*100}%`, top:`${(y+0.025*Math.cos(t*0.7+ph))*100}%`, transform:"translate(-50%,-50%)", background:alpha(c,0.16)})}/>)}
    </div>;
    case "stickers": { const a=pop(frame,fps,0.1), b=pop(frame,fps,0.25); const sticker={border:`${u*0.6}px solid ${theme.line}`, boxShadow:`${u*0.9}px ${u*0.9}px 0 ${theme.line}`}; return <div style={fill}>
      <div style={{...fill, backgroundImage:`radial-gradient(${alpha("#000000",0.12)} ${u*0.18}px, transparent ${u*0.2}px)`, backgroundSize:`${u*3.6}px ${u*3.6}px`}}/>
      <div style={abs({top:"5%", right:"6%", width:u*15, height:u*15, borderRadius:"50%", background:s, ...sticker, transform:`rotate(12deg) scale(${a})`})}/>
      <div style={abs({bottom:"6%", left:"6%", width:u*22, height:u*8, background:q, ...sticker, transform:`rotate(-6deg) scale(${b})`})}/>
    </div>; }
    case "frame": { const sheen=((t*0.18)%1.6-0.3)*100; const corner=(pos) => <div style={abs({...pos, width:u*1.6, height:u*1.6, background:s, transform:"translate(-50%,-50%) rotate(45deg)"})}/>; return <div style={fill}>
      <div style={{...fill, background:"radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,.45))"}}/>
      <div style={{...fill, background:`linear-gradient(115deg, transparent ${sheen-8}%, rgba(255,255,255,.06) ${sheen}%, transparent ${sheen+8}%)`}}/>
      <div style={abs({inset:u*3, border:`${u*0.16}px solid ${alpha(s,0.85)}`})}/>
      <div style={abs({inset:u*4.3, border:`${u*0.08}px solid ${alpha(s,0.45)}`})}/>
      {corner({left:u*3, top:u*3})}{corner({left:`calc(100% - ${u*3}px)`, top:u*3})}{corner({left:u*3, top:`calc(100% - ${u*3}px)`})}{corner({left:`calc(100% - ${u*3}px)`, top:`calc(100% - ${u*3}px)`})}
    </div>; }
    case "hud": { const size=Math.min(width,height)*0.92, k=u*9, w=u*0.5; const bracket=(pos, sides) => <div style={abs({...pos, width:k, height:k, ...Object.fromEntries(sides.map((d) => [`border${d}`, `${w}px solid ${p}`]))})}/>; return <div style={fill}>
      <div style={abs({left:"50%", top:"50%", width:size, height:size, transform:"translate(-50%,-50%)", borderRadius:"50%", border:`${u*0.15}px solid ${alpha(s,0.22)}`,
        background:`conic-gradient(from ${t*80}deg, ${alpha(s,0.22)}, transparent 70deg, transparent)`})}/>
      <div style={abs({left:"50%", top:"50%", width:size*0.6, height:size*0.6, transform:"translate(-50%,-50%)", borderRadius:"50%", border:`${u*0.12}px dashed ${alpha(s,0.25)}`})}/>
      <div style={abs({left:"50%", top:0, bottom:0, borderLeft:`${u*0.1}px solid ${alpha(s,0.12)}`})}/>
      <div style={abs({top:"50%", left:0, right:0, borderTop:`${u*0.1}px solid ${alpha(s,0.12)}`})}/>
      {bracket({left:"4%", top:"4%"},["Top","Left"])}{bracket({right:"4%", top:"4%"},["Top","Right"])}{bracket({left:"4%", bottom:"4%"},["Bottom","Left"])}{bracket({right:"4%", bottom:"4%"},["Bottom","Right"])}
      <div style={abs({right:"6%", top:"6%", font:`${u*1.8}px ${theme.headingFont}`, color:readable([q], theme.background, theme.muted), opacity:0.6+0.4*Math.sin(t*6)})}>● REC</div>
    </div>; }
    case "halftone": return <div style={fill}>
      <div style={{...fill, background:`repeating-conic-gradient(from ${t*6}deg at 50% 45%, rgba(255,255,255,.09) 0deg 8deg, transparent 8deg 16deg)`}}/>
      <div style={{...fill, backgroundImage:`radial-gradient(rgba(0,0,0,.22) ${u*0.45}px, transparent ${u*0.5}px)`, backgroundSize:`${u*2.6}px ${u*2.6}px`, WebkitMaskImage:"radial-gradient(ellipse at center, transparent 30%, #000 85%)"}}/>
    </div>;
    case "beam": { const x=((t*0.22)%1.5-0.45)*100; return <div style={fill}>
      <div style={{...fill, backgroundImage:`radial-gradient(rgba(255,255,255,.07) ${u*0.1}px, transparent ${u*0.12}px)`, backgroundSize:`${u*3}px ${u*3}px`}}/>
      <div style={{...fill, background:`radial-gradient(ellipse at 50% -10%, ${alpha(p,0.38)}, transparent 55%)`}}/>
      <div style={abs({left:`${x}%`, width:"45%", top:"7%", height:u*0.22, background:`linear-gradient(90deg, transparent, ${p}, ${s}, transparent)`})}/>
      <div style={abs({right:`${x}%`, width:"45%", bottom:"7%", height:u*0.22, background:`linear-gradient(90deg, transparent, ${q}, ${p}, transparent)`})}/>
    </div>; }
    default: return null;
  }
};

// isolation creates a stacking context, so the effect (z-index -1) paints over the background but under the content.
const Backdrop = ({theme, style, children}) => <AbsoluteFill style={{background:`linear-gradient(160deg, ${theme.background} 0%, ${theme.background2} 100%)`, color:theme.text, fontFamily:theme.font, justifyContent:"center", alignItems:"center", textAlign:"center", padding:"8%", boxSizing:"border-box", isolation:"isolate", ...style}}>
  <div style={{position:"absolute", inset:0, zIndex:-1, overflow:"hidden"}}><Effect theme={theme}/></div>
  {children}
</AbsoluteFill>;

const TitleScreen = ({text, kicker, subtitle, theme}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit();
  return <Backdrop theme={theme}>
    {kicker && <div style={{...rise(frame,fps,u), color:theme.accentText, fontWeight:800, fontSize:u*4, letterSpacing:u*0.5, textTransform:"uppercase", marginBottom:u*3}}>{kicker}</div>}
    <div style={{...rise(frame,fps,u,0.1), ...heading(theme), fontWeight:800, fontSize:fitSize(text,u*8,width,0.62*wide(theme)), lineHeight:1.12}}>{text}</div>
    {subtitle && <div style={{...rise(frame,fps,u,0.3), color:theme.muted, fontSize:u*4.4, marginTop:u*3}}>{subtitle}</div>}
  </Backdrop>;
};

const ChapterScreen = ({number, title, subtitle, theme}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit();
  return <Backdrop theme={theme}>
    {number!==undefined && <div style={{...rise(frame,fps,u), color:theme.accentText, fontFamily:theme.headingFont, fontWeight:900, fontSize:u*26, lineHeight:1}}>{String(number).padStart(2,"0")}</div>}
    <div style={{height:u*1, width:`${ease(frame,fps,0.15)*40}%`, background:theme.highlight, margin:`${u*3}px 0`}}/>
    <div style={{...rise(frame,fps,u,0.25), ...heading(theme), fontWeight:800, fontSize:fitSize(title,u*7.5,width,0.62*wide(theme)), lineHeight:1.12}}>{title}</div>
    {subtitle && <div style={{...rise(frame,fps,u,0.4), color:theme.muted, fontSize:u*4.2, marginTop:u*2.4}}>{subtitle}</div>}
  </Backdrop>;
};

const QuoteScreen = ({quote, author, theme}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const u=useUnit();
  return <Backdrop theme={theme}>
    <div style={{...rise(frame,fps,u), color:theme.accentText, fontFamily:"Georgia, serif", fontSize:u*34, lineHeight:0.6, height:u*14}}>“</div>
    <div style={{...rise(frame,fps,u,0.15), fontFamily:theme.quoteFont ?? theme.headingFont, fontStyle:"italic", fontSize:u*6.4, lineHeight:1.25}}>{quote}</div>
    {author && <div style={{...rise(frame,fps,u,0.4), color:theme.muted, fontWeight:700, fontSize:u*4, marginTop:u*4}}>— {author}</div>}
  </Backdrop>;
};

const ListScreen = ({title, items=[], icon="check", color, theme, duration}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const u=useUnit();
  const step=Math.min(0.5,Math.max(0.15,(duration/fps-1.2)/Math.max(1,items.length)));
  return <Backdrop theme={theme} style={{alignItems:"stretch"}}>
    {title && <div style={{...rise(frame,fps,u), ...heading(theme), fontWeight:800, fontSize:u*7, marginBottom:u*5}}>{title}</div>}
    {items.map((item,i)=><div key={i} style={{...rise(frame,fps,u,0.35+i*step,0), transform:`translateX(${(1-ease(frame,fps,0.35+i*step))*-u*10}px)`, display:"flex", alignItems:"center", gap:u*2.4, textAlign:"left", ...panel(theme,u), padding:`${u*2}px ${u*2.6}px`, marginBottom:u*2.4, fontSize:u*4.6, fontWeight:700}}>
      <div style={{background:color??theme.accent, borderRadius:"50%", padding:u*1}}><Icon name={icon} size={u*4.4} color={color ? onColor(color) : theme.onPrimary} stroke={2.8}/></div>{item}
    </div>)}
  </Backdrop>;
};

const StatScreen = ({value, prefix="", suffix="", label, note, decimals=0, locale, seconds=1.4, theme}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit(); const n=useCount(value,0.2,seconds);
  const full=`${prefix}${formatNumber(value,decimals,locale)}${suffix}`;
  return <Backdrop theme={theme}>
    <div style={{...rise(frame,fps,u), color:theme.highlightText, fontFamily:theme.headingFont, fontWeight:900, fontSize:fitSize(full,u*22,width,0.6*wide(theme)), lineHeight:1}}>{prefix}{formatNumber(n,decimals,locale)}{suffix}</div>
    {label && <div style={{...rise(frame,fps,u,0.3), fontWeight:800, fontSize:u*6, marginTop:u*3}}>{label}</div>}
    {note && <div style={{...rise(frame,fps,u,0.6), color:theme.muted, fontSize:u*4, marginTop:u*2.4}}>{note}</div>}
  </Backdrop>;
};

const ComparePanel = ({side, color, u, offset, theme}) => <div style={{flex:1, alignSelf:"stretch", ...panel(theme,u), borderTop:`${u*1}px solid ${color}`, padding:u*3.4, transform:offset, textAlign:"left", display:"flex", flexDirection:"column", justifyContent:"center"}}>
  <div style={{color:readable([color, theme.accentText], isHexColor(theme.surface) ? theme.surface : theme.background, theme.surfaceText ?? theme.text), ...heading(theme), fontWeight:900, fontSize:u*5.6, marginBottom:u*1.6}}>{side.label}</div>
  {side.text && <div style={{fontSize:u*4.2, color:theme.surfaceText ?? theme.text}}>{side.text}</div>}
  {(side.items??[]).map((t,i)=><div key={i} style={{fontSize:u*4.2, marginTop:u*1}}>• {t}</div>)}
</div>;

const CompareScreen = ({title, left={}, right={}, theme}) => {
  const frame=useCurrentFrame(); const {fps, width, height}=useVideoConfig(); const u=useUnit();
  const row=width>height, a=ease(frame,fps,0.15), b=ease(frame,fps,0.35), vs=pop(frame,fps,0.55);
  const slide=(p,dir)=>row ? `translateX(${(1-p)*dir*u*20}px)` : `translateY(${(1-p)*dir*u*20}px)`;
  return <Backdrop theme={theme}>
    {title && <div style={{...rise(frame,fps,u), ...heading(theme), fontWeight:800, fontSize:u*6.4, marginBottom:u*4}}>{title}</div>}
    <div style={{display:"flex", flexDirection:row?"row":"column", alignItems:"center", gap:u*3, width:"100%", flex:row?undefined:1, maxHeight:row?undefined:"70%"}}>
      <div style={{flex:1, width:"100%", display:"flex", opacity:a}}><ComparePanel side={left} color={left.color??theme.tertiary} u={u} offset={slide(a,-1)} theme={theme}/></div>
      <div style={{background:theme.highlight, color:theme.onSecondary, fontFamily:theme.headingFont, fontWeight:900, fontSize:u*5, borderRadius:"50%", width:u*14, height:u*14, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transform:`scale(${vs})`}}>VS</div>
      <div style={{flex:1, width:"100%", display:"flex", opacity:b}}><ComparePanel side={right} color={right.color??theme.primary} u={u} offset={slide(b,1)} theme={theme}/></div>
    </div>
  </Backdrop>;
};

const clean = w => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
const KineticScreen = ({text="", highlight=[], theme, duration}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit();
  const words=text.split(/\s+/).filter(Boolean), marked=new Set(highlight.map(clean));
  const step=Math.min(0.28,(duration/fps*0.6)/Math.max(1,words.length));
  return <Backdrop theme={theme}><div style={{fontFamily:theme.headingFont, fontWeight:900, fontSize:fitSize(text,u*9.5,width,0.9), lineHeight:1.15, textTransform:"uppercase"}}>
    {words.map((w,i)=>{ const p=pop(frame,fps,0.1+i*step); return <span key={i} style={{display:"inline-block", margin:`0 ${u*1.2}px`, opacity:Math.min(1,p), transform:`scale(${p})`, color:marked.has(clean(w))?theme.highlightText:theme.text}}>{w}</span>; })}
  </div></Backdrop>;
};

// Uses the theme background and text (a fixed dark red left dark text unreadable on light presets,
// 1.16:1 on editorial); the band is the theme primary unless the screen sets `color`.
const BreakingScreen = ({label="Breaking", title, text, ticker, color, theme}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit();
  const band=ease(frame,fps), accent=color ?? theme.primary, onAccent=onColor(accent);
  return <Backdrop theme={{...theme, effect:"none"}}>
    <div style={{background:accent, color:onAccent, fontWeight:900, fontSize:u*5.4, textTransform:"uppercase", letterSpacing:u*0.4, padding:`${u*1.6}px ${u*4}px`, transform:`rotate(-3deg) scaleX(${band})`, marginBottom:u*5, display:"flex", alignItems:"center", gap:u*1.6}}>
      <Icon name="alert" size={u*6} color={onAccent} stroke={2.6}/>{label}
    </div>
    {title && <div style={{...rise(frame,fps,u,0.25), fontFamily:theme.headingFont, fontWeight:900, fontSize:fitSize(title,u*8,width,0.66), lineHeight:1.1}}>{title}</div>}
    {text && <div style={{...rise(frame,fps,u,0.45), color:theme.muted, fontSize:u*4.4, marginTop:u*3}}>{text}</div>}
    {ticker && <div style={{position:"absolute", left:0, right:0, bottom:"6%", height:u*7, background:theme.text, color:theme.background, overflow:"hidden", display:"flex", alignItems:"center"}}>
      <Marquee text={ticker} font={`700 ${u*3.8}px ${theme.font}`} speed={u*30} startX={u*10} frame={frame} fps={fps}/>
    </div>}
  </Backdrop>;
};

// Designed for horizontal video (side by side); both stack into a column in vertical video.
const SplitScreen = ({kicker, title, text, icon="bulb", value, prefix="", suffix="", decimals=0, locale, label, side="left", color, theme}) => {
  const frame=useCurrentFrame(); const {fps, width, height}=useVideoConfig(); const u=useUnit();
  const row=width>height, c=color??theme.accent, colWidth=row?width/2:width, n=useCount(value??0,0.3,1.4), s=pop(frame,fps,0.35);
  const words=<div key="text" style={{flex:1, textAlign:"left"}}>
    {kicker && <div style={{...rise(frame,fps,u), color:color ?? theme.accentText, fontWeight:800, fontSize:u*3.8, letterSpacing:u*0.4, textTransform:"uppercase", marginBottom:u*2}}>{kicker}</div>}
    {title && <div style={{...rise(frame,fps,u,0.1), ...heading(theme), fontWeight:800, fontSize:fitSize(title,u*7.5,colWidth,0.62*wide(theme)), lineHeight:1.1}}>{title}</div>}
    {text && <div style={{...rise(frame,fps,u,0.3), color:theme.muted, fontSize:u*4, marginTop:u*2.4, lineHeight:1.35}}>{text}</div>}
  </div>;
  const visual=<div key="visual" style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", transform:`scale(${s})`}}>
    {value!==undefined
      ? <div style={{color:theme.highlightText, fontFamily:theme.headingFont, fontWeight:900, fontSize:fitSize(`${prefix}${formatNumber(value,decimals,locale)}${suffix}`,u*20,colWidth,0.6), lineHeight:1}}>{prefix}{formatNumber(n,decimals,locale)}{suffix}</div>
      : <div style={{background:c, borderRadius:"50%", padding:u*5, boxShadow:shadowOf(theme,u)}}><Icon name={icon} size={u*22} color={onColor(c)} stroke={2}/></div>}
    {label && <div style={{fontWeight:700, fontSize:u*4.2, marginTop:u*2.4}}>{label}</div>}
  </div>;
  return <Backdrop theme={theme} style={{flexDirection:row?"row":"column", gap:u*6, padding:row?"6% 8%":"12% 8%"}}>{side==="right"?[visual,words]:[words,visual]}</Backdrop>;
};

const TimelineScreen = ({title, steps=[], color, theme, duration}) => {
  const frame=useCurrentFrame(); const {fps, width, height}=useVideoConfig(); const u=useUnit();
  const row=width>height, c=color??theme.accent, list=steps.map(s=>typeof s==="string"?{label:s}:s), n=Math.max(1,list.length);
  const step=Math.min(0.6,Math.max(0.2,(duration/fps-1.4)/n));
  const line=interpolate(frame,[Math.round(0.3*fps),Math.round((0.3+step*(n-1))*fps)+1],[0,1],clamp);
  const track=row?{left:`${50/n}%`, right:`${50/n}%`, top:u*4.6, height:u*0.8}:{top:u*5, bottom:u*5, left:u*4.6, width:u*0.8};
  return <Backdrop theme={theme}>
    {title && <div style={{...rise(frame,fps,u), ...heading(theme), fontWeight:800, fontSize:u*6.4, marginBottom:u*6}}>{title}</div>}
    <div style={{position:"relative", display:"flex", flexDirection:row?"row":"column", width:"100%", gap:u*3}}>
      <div style={{position:"absolute", background:theme.line, ...track}}><div style={{background:c, width:row?`${line*100}%`:"100%", height:row?"100%":`${line*100}%`}}/></div>
      {list.map((s,i)=>{ const p=pop(frame,fps,0.3+i*step), q=ease(frame,fps,0.4+i*step); return <div key={i} style={{flex:1, display:"flex", flexDirection:row?"column":"row", alignItems:"center", gap:u*2.4, textAlign:row?"center":"left", position:"relative"}}>
        <div style={{width:u*10, height:u*10, borderRadius:"50%", background:c, color:onColor(c), fontFamily:theme.headingFont, fontWeight:900, fontSize:u*4.4, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:"0 6px 18px rgba(0,0,0,.35)", transform:`scale(${p})`}}>{i+1}</div>
        <div style={{opacity:q, transform:`translateY(${(1-q)*u*3}px)`}}>
          <div style={{fontWeight:800, fontSize:u*4.4}}>{s.label}</div>
          {s.text && <div style={{color:theme.muted, fontSize:u*3.2, marginTop:u*0.8}}>{s.text}</div>}
        </div>
      </div>; })}
    </div>
  </Backdrop>;
};

// Full-frame picture (news photo, person, screenshot) with a slow Ken Burns push and an optional caption.
// `src` is a file in public/ or a data:/http(s): URL; `fit` is "cover" (default) or "contain".
const ImageScreen = ({src, fit="cover", title, caption, credit, kenBurns=true, theme, duration}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const u=useUnit();
  if (!src) throw new Error(`Screen "image" needs a src (file in public/ or URL)`);
  const url=/^(https?:|data:)/.test(src) ? src : staticFile(src);
  const zoom=kenBurns ? interpolate(frame,[0,Math.max(1,duration)],[1.0,1.08],clamp) : 1;
  return <AbsoluteFill style={{background:theme.background, fontFamily:theme.font}}>
    {fit==="contain" && <Img src={url} style={{position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", filter:"blur(40px) brightness(.5)", transform:"scale(1.2)"}}/>}
    <Img src={url} style={{position:"absolute", inset:0, width:"100%", height:"100%", objectFit:fit, transform:`scale(${zoom})`}}/>
    {(title || caption) && <div style={{position:"absolute", left:0, right:0, bottom:0, padding:`${u*14}px ${u*5}px ${u*7}px`, background:"linear-gradient(transparent, rgba(0,0,0,.85))", color:OVERLAY_TEXT, textAlign:"left"}}>
      {title && <div style={{...rise(frame,fps,u,0.15), ...heading(theme), fontWeight:900, fontSize:u*6.4, lineHeight:1.1}}>{title}</div>}
      {caption && <div style={{...rise(frame,fps,u,0.3), color:OVERLAY_MUTED, fontSize:u*4, marginTop:u*1.6}}>{caption}</div>}
    </div>}
    {credit && <div style={{position:"absolute", right:u*2, top:u*2, color:"rgba(255,255,255,.75)", fontSize:u*2.4, background:"rgba(0,0,0,.45)", padding:`${u*0.6}px ${u*1.2}px`, borderRadius:u*0.8}}>{credit}</div>}
  </AbsoluteFill>;
};

export const SCREENS = {title:TitleScreen, chapter:ChapterScreen, quote:QuoteScreen, list:ListScreen, stat:StatScreen, compare:CompareScreen, kinetic:KineticScreen, breaking:BreakingScreen, split:SplitScreen, timeline:TimelineScreen, image:ImageScreen};

// Dispatchers used by Video.jsx; `duration` is the item length in frames. Unknown types fail loudly in Studio.
const pick = (registry, kind, type) => {
  const Component=registry[type];
  if (!Component) throw new Error(`Unknown ${kind} type "${type}". Available: ${Object.keys(registry).join(", ")}`);
  return Component;
};
export const Overlay = ({item, duration, theme}) => {
  const {start, end, type="callout", theme:own, at, word, occurrence, offset, endWord, endOccurrence, sfx, ...props}=item;
  const Component=pick(OVERLAYS,"overlay",type);
  return <Component {...props} duration={duration} theme={resolveTheme({...theme, ...own})}/>;
};
// `transition`: "fade" (default, 0.2 s), "slide" (from below), "wipe" (left to right) or "zoom"
// (scales down into place); 0.3 s for the motion ones. The exit mirrors the entrance.
const TRANSITIONS = ["fade","slide","wipe","zoom"];
export const Screen = ({item, duration, theme}) => {
  const {start, end, type="title", theme:own, transition="fade", at, word, occurrence, offset, endWord, endOccurrence, sfx, sfxOut, ...props}=item;
  const Component=pick(SCREENS,"screen",type);
  if (!TRANSITIONS.includes(transition)) throw new Error(`Unknown transition "${transition}". Available: ${TRANSITIONS.join(", ")}`);
  const frame=useCurrentFrame(); const {fps}=useVideoConfig();
  const len=Math.max(1,Math.min(Math.round((transition==="fade"?0.2:0.3)*fps),Math.floor(duration/2)));
  const opts={...clamp, easing:Easing.out(Easing.cubic)};
  const p=Math.min(interpolate(frame,[0,len],[0,1],opts),interpolate(frame,[duration-len,duration],[1,0],{...clamp, easing:Easing.in(Easing.cubic)}));
  const style = transition==="slide" ? {transform:`translateY(${(1-p)*100}%)`}
    : transition==="wipe" ? {clipPath:`inset(0 ${(1-p)*100}% 0 0)`}
    : transition==="zoom" ? {opacity:p, transform:`scale(${1.08-0.08*p})`}
    : {opacity:p};
  return <AbsoluteFill style={style}><Component {...props} duration={duration} theme={resolveTheme({...theme, ...own})}/></AbsoluteFill>;
};

// ---------- Gallery composition: preview of every component in Studio ----------
// Inline placeholder portrait, so the gallery needs no file in public/.
const GALLERY_PORTRAIT = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3b4a66"/><circle cx="50" cy="38" r="18" fill="#c8d2e6"/><path d="M14 100c4-24 18-34 36-34s32 10 36 34z" fill="#c8d2e6"/></svg>');
export const galleryItems = [
  {kind:"overlay", item:{type:"callout", text:"Key point from the video"}},
  {kind:"overlay", item:{type:"lowerThird", title:"Jane Doe", subtitle:"Role or channel"}},
  {kind:"overlay", item:{type:"alert", variant:"info", title:"Worth knowing", text:"This changes how the model is trained"}},
  {kind:"overlay", item:{type:"alert", variant:"success", title:"It works", text:"The test finished without errors"}},
  {kind:"overlay", item:{type:"alert", variant:"warning", title:"Careful", text:"Check the configuration before continuing"}},
  {kind:"overlay", item:{type:"alert", variant:"error", title:"Error", text:"The API rejected the request"}},
  {kind:"overlay", item:{type:"notification", app:"Messages", title:"New model available", text:"You can try it from the terminal"}},
  {kind:"overlay", item:{type:"icon", icon:"bulb", label:"Idea", color:"#f59e0b"}},
  {kind:"overlay", item:{type:"badge", text:"New", icon:"star"}},
  {kind:"overlay", item:{type:"counter", value:1250000, prefix:"$", label:"Announced investment"}},
  {kind:"overlay", item:{type:"cta"}},
  {kind:"overlay", item:{type:"image", src:GALLERY_PORTRAIT, title:"Jane Doe", subtitle:"CEO, Example Corp", credit:"Placeholder image"}},
  {kind:"screen", item:{type:"title", kicker:"Special chapter", text:"The race for AI infrastructure", subtitle:"What changes in 2026"}},
  {kind:"screen", item:{type:"chapter", number:2, title:"How it works", subtitle:"Step by step"}},
  {kind:"screen", item:{type:"quote", quote:"The best way to predict the future is to invent it.", author:"Alan Kay"}},
  {kind:"screen", item:{type:"list", title:"Three keys", items:["Clean data","Smaller models","Constant evaluation"]}},
  {kind:"screen", item:{type:"stat", value:93.5, decimals:1, suffix:"%", label:"accuracy", note:"against 78% for the previous model"}},
  {kind:"screen", item:{type:"compare", title:"Before vs. now", left:{label:"Before", items:["Hours of rendering","Manual editing"]}, right:{label:"Now", items:["Minutes","Automatic plan"]}}},
  {kind:"screen", item:{type:"kinetic", text:"This changes everything for developers", highlight:["everything"]}},
  {kind:"screen", item:{type:"breaking", title:"The new model ships", text:"Available today", ticker:"Faster · Cheaper · Open source · Available in the terminal"}},
  {kind:"screen", item:{type:"image", transition:"slide", src:"data:image/svg+xml;utf8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#1d3b73"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1150" cy="330" r="190" fill="#ffe456" opacity=".85"/></svg>'), title:"Image of the news", caption:"Photo or screenshot from public/", credit:"Source: placeholder"}},
  {kind:"screen", item:{type:"title", transition:"wipe", kicker:"Transition", text:"Wipe between cards"}},
  {kind:"screen", item:{type:"title", transition:"zoom", kicker:"Transition", text:"Zoom into place"}},
];
// Horizontal-first components, shown before the general ones in the GalleryHorizontal composition (1920×1080).
export const horizontalItems = [
  {kind:"overlay", item:{type:"sidePanel", title:"What you will see", items:["Install","Configure","First render"]}},
  {kind:"overlay", item:{type:"ticker", label:"Live", text:"New model available · 40% faster · Already in the terminal · Open source"}},
  {kind:"screen", item:{type:"split", kicker:"Concept", title:"Local rendering with Remotion", text:"Everything runs on your machine, with no upload to any server.", icon:"cpu"}},
  {kind:"screen", item:{type:"split", side:"right", title:"Faster than before", text:"The same video, on the same machine.", value:3, suffix:"x", label:"render speed"}},
  {kind:"screen", item:{type:"timeline", title:"How it works", steps:[{label:"Transcribe", text:"Words with timings"},{label:"Cut", text:"Silences out"},{label:"Decorate", text:"Overlays and zoom"},{label:"Export", text:"Final MP4"}]}},
];
export const horizontalGallery = [...horizontalItems, ...galleryItems];

const GALLERY_SECONDS = 3;
export const galleryDuration = (fps, items=galleryItems) => items.length*Math.round(GALLERY_SECONDS*fps);

export const Gallery = ({theme, items=galleryItems}) => {
  const {fps}=useVideoConfig(); const u=useUnit(); const len=Math.round(GALLERY_SECONDS*fps);
  return <AbsoluteFill style={{background:"linear-gradient(135deg, #3a3f4b 0%, #1e2128 100%)"}}>
    <AbsoluteFill style={{justifyContent:"center", alignItems:"center", color:"rgba(255,255,255,.08)", font:`900 ${u*16}px Arial`}}>VIDEO</AbsoluteFill>
    {items.map(({kind,item},i)=><Sequence key={i} name={`${kind}: ${item.type}`} from={i*len} durationInFrames={len}>
      {kind==="overlay" ? <Overlay item={item} duration={len} theme={theme}/> : <Screen item={item} duration={len} theme={theme}/>}
      <div style={{position:"absolute", left:"4%", bottom:"3%", color:"#fff", background:"rgba(0,0,0,.6)", font:`${u*2.6}px monospace`, padding:`${u*0.6}px ${u*1.4}px`, borderRadius:u*0.8}}>{kind}: {item.type}{item.variant?` (${item.variant})`:""}</div>
    </Sequence>)}
  </AbsoluteFill>;
};

// ---------- Theme previews: show the user every preset so they can pick one ----------
// One card with every themed element: kicker, heading, figure, panels, chip and the three colors.
export const ThemePreview = ({theme:raw={}, name}) => {
  const theme=resolveTheme(raw); const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit();
  const label=name ?? theme.preset;
  return <Backdrop theme={theme} style={{gap:u*2.6}}>
    <div style={{...rise(frame,fps,u), color:theme.accentText, fontWeight:800, fontSize:u*3.4, letterSpacing:u*0.4, textTransform:"uppercase"}}>theme · {label}</div>
    <div style={{...rise(frame,fps,u,0.1), ...heading(theme), fontWeight:800, fontSize:fitSize(THEMES[theme.preset].label,u*8,width,0.62*wide(theme)), lineHeight:1.1}}>{THEMES[theme.preset].label}</div>
    <div style={{...rise(frame,fps,u,0.2), color:theme.highlightText, fontFamily:theme.headingFont, fontWeight:900, fontSize:u*12, lineHeight:1}}>93%</div>
    <div style={{display:"flex", flexDirection:"column", gap:u*1.8, width:"100%", maxWidth:u*90}}>
      {["Primary marks the key point","Panels follow the theme"].map((text,i) => { const p=ease(frame,fps,0.3+i*0.15); return <div key={i} style={{...panel(theme,u), display:"flex", alignItems:"center", gap:u*2, padding:`${u*1.6}px ${u*2.2}px`, fontSize:u*3.6, fontWeight:700, textAlign:"left", opacity:p, transform:`translateX(${(1-p)*-u*8}px)`}}>
        <div style={{background:i?theme.tertiary:theme.primary, borderRadius:"50%", padding:u*0.8}}><Icon name={i?"star":"check"} size={u*3.6} color={i?onColor(theme.tertiary):theme.onPrimary} stroke={2.8}/></div>{text}
      </div>; })}
    </div>
    <div style={{...rise(frame,fps,u,0.6), display:"flex", gap:u*2.4, fontSize:u*2.4, color:theme.muted, fontFamily:'Consolas, "Courier New", monospace'}}>
      {["primary","secondary","tertiary"].map((key) => <div key={key} style={{display:"flex", alignItems:"center", gap:u*0.8}}>
        <div style={{width:u*3.2, height:u*3.2, borderRadius:"50%", background:theme[key], border:`${u*0.2}px solid ${alpha(theme.text,0.35)}`}}/>{key} {theme[key]}
      </div>)}
    </div>
  </Backdrop>;
};

// Every preset on one frame (4 × 4 grid): render it as a still and show the image to the user.
// Tiles are full-size previews scaled down, starting 2.5 s into their animation so they are settled.
export const ThemeSheet = ({themes=THEME_NAMES, overrides={}}) => {
  const {width, height, fps}=useVideoConfig();
  const cols=4, rows=Math.ceil((themes.length+1)/cols), tw=width/cols, th=height/rows, scale=Math.min(tw/width, th/height);
  return <AbsoluteFill style={{background:"#0b0b0f"}}>
    {themes.map((name,i) => <div key={name} style={{position:"absolute", left:(i%cols)*tw, top:Math.floor(i/cols)*th, width:tw, height:th, overflow:"hidden", outline:"1px solid #000"}}>
      <div style={{position:"absolute", left:(tw-width*scale)/2, top:(th-height*scale)/2, width, height, transform:`scale(${scale})`, transformOrigin:"0 0"}}>
        <Sequence from={-Math.round(2.5*fps)} layout="none"><ThemePreview theme={{...overrides, preset:name}} name={name}/></Sequence>
      </div>
    </div>)}
    <div style={{position:"absolute", left:(themes.length%cols)*tw, top:Math.floor(themes.length/cols)*th, width:tw, height:th, display:"flex", flexDirection:"column", justifyContent:"center", padding:tw*0.08, boxSizing:"border-box", color:"#e5e7eb", font:`${Math.min(tw,th)*0.07}px Consolas, monospace`, lineHeight:1.5}}>
      <div style={{fontWeight:700, fontSize:Math.min(tw,th)*0.09, marginBottom:Math.min(tw,th)*0.04}}>theme.preset</div>
      <div>theme: {"{"}preset: "neon",</div><div>&nbsp;primary: "#…",</div><div>&nbsp;secondary: "#…",</div><div>&nbsp;tertiary: "#…"{"}"}</div>
    </div>
  </AbsoluteFill>;
};
export const themeSheetRows = (count=THEME_NAMES.length) => Math.ceil((count+1)/4);

// Animated tour: each preset full frame for 3 s, so the user sees the motion of each effect.
const REEL_SECONDS = 3;
export const themeReelDuration = (fps, themes=THEME_NAMES) => themes.length*Math.round(REEL_SECONDS*fps);
export const ThemeReel = ({themes=THEME_NAMES, overrides={}}) => {
  const {fps}=useVideoConfig(); const len=Math.round(REEL_SECONDS*fps);
  return <AbsoluteFill style={{background:"#000"}}>
    {themes.map((name,i) => <Sequence key={name} name={`theme: ${name}`} from={i*len} durationInFrames={len}><ThemePreview theme={{...overrides, preset:name}} name={name}/></Sequence>)}
  </AbsoluteFill>;
};
