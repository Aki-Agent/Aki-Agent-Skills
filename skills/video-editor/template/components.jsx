import React from "react";
import {AbsoluteFill, Sequence, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";

// Ready-to-use overlays, alerts, icons and full-screen text screens.
// edit.js items are {start, end, type, ...props}; sizes scale with the shorter side of the video.
export const defaultTheme = {accent:"#3d8bff", highlight:"#ffe456", background:"#0c1831", background2:"#1d3b73", card:"#112b52", text:"#ffffff", muted:"#b9c6dd", font:"Arial, Helvetica, sans-serif"};
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

// Positions: top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, bottom-right.
// "bottom" stays above the caption area (26% from the bottom).
const Place = ({position="top-left", children}) => {
  const [v,h=v]=position.split("-");
  const axis = s => s==="left"||s==="top" ? "flex-start" : s==="right"||s==="bottom" ? "flex-end" : "center";
  return <AbsoluteFill style={{flexDirection:"row", justifyContent:axis(h), alignItems:axis(v), padding:"7% 5% 26%", boxSizing:"border-box"}}>{children}</AbsoluteFill>;
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
    {subtitle && <div style={{background:"rgba(0,0,0,.78)", color:theme.text, fontWeight:600, fontSize:u*3.4, padding:`${u*1}px ${u*2.6}px`, clipPath:`inset(0 ${(1-b)*100}% 0 0)`}}>{subtitle}</div>}
  </div></Place>;
};

const Alert = ({variant="info", title, text, icon, position="top-center", theme, duration}) => {
  const {frame, fps, enter, exit}=useLife(duration); const u=useUnit();
  const v=variants[variant] ?? variants.info;
  const shake=variant==="error"||variant==="warning" ? Math.sin(frame*1.3)*u*0.7*interpolate(frame,[fps*0.4,fps*1],[1,0],clamp)*(frame>fps*0.4?1:0) : 0;
  return <Place position={position}><div style={{display:"flex", alignItems:"center", gap:u*2.4, width:"88%", boxSizing:"border-box", background:"rgba(10,15,30,.92)", borderLeft:`${u*1}px solid ${v.color}`, borderRadius:u*2, padding:`${u*2.4}px ${u*3}px`, boxShadow:"0 10px 30px rgba(0,0,0,.45)", fontFamily:theme.font, color:theme.text, opacity:exit, transform:`translate(${shake}px, ${(1-enter)*-u*18}px)`}}>
    <div style={{background:v.color, borderRadius:"50%", padding:u*1.4}}><Icon name={icon??v.icon} size={u*6} color="#fff" stroke={2.6}/></div>
    <div style={{textAlign:"left"}}>
      {title && <div style={{fontWeight:800, fontSize:u*4.4}}>{title}</div>}
      {text && <div style={{fontSize:u*3.4, color:theme.muted, marginTop:u*0.6}}>{text}</div>}
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
    {label && <div style={{background:"rgba(0,0,0,.75)", color:theme.text, font:`800 ${u*4.4}px ${theme.font}`, padding:`${u*1}px ${u*2.4}px`, borderRadius:u*1.4}}>{label}</div>}
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
    {label && <div style={{color:theme.text, fontWeight:700, fontSize:u*3.6, marginTop:u*1}}>{label}</div>}
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
    <div style={{width:"34%", minWidth:u*40, background:"rgba(10,15,30,.86)", borderRadius:u*2.4, borderTop:`${u*0.8}px solid ${c}`, padding:u*3.4, boxSizing:"border-box", fontFamily:theme.font, color:theme.text, textAlign:"left", boxShadow:"0 10px 30px rgba(0,0,0,.4)", opacity:exit, transform:`translateX(${(1-enter)*dir*u*40}px)`}}>
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
      <div style={{position:"absolute", whiteSpace:"nowrap", color:theme.text, fontWeight:700, fontSize:u*3.6, transform:`translateX(${width*0.6-frame/fps*u*25*speed}px)`}}>{text}</div>
    </div>
  </div>;
};

export const OVERLAYS = {callout:Callout, lowerThird:LowerThird, alert:Alert, notification:Notification, icon:IconPop, badge:Badge, counter:Counter, cta:Cta, sidePanel:SidePanel, ticker:Ticker};

// ---------- Full-screen screens (replace the picture; speech audio continues) ----------
const Backdrop = ({theme, style, children}) => <AbsoluteFill style={{background:`linear-gradient(160deg, ${theme.background} 0%, ${theme.background2} 100%)`, color:theme.text, fontFamily:theme.font, justifyContent:"center", alignItems:"center", textAlign:"center", padding:"8%", boxSizing:"border-box", ...style}}>{children}</AbsoluteFill>;

const TitleScreen = ({text, kicker, subtitle, theme}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit();
  return <Backdrop theme={theme}>
    {kicker && <div style={{...rise(frame,fps,u), color:theme.accent, fontWeight:800, fontSize:u*4, letterSpacing:u*0.5, textTransform:"uppercase", marginBottom:u*3}}>{kicker}</div>}
    <div style={{...rise(frame,fps,u,0.1), fontWeight:800, fontSize:fitSize(text,u*8,width), lineHeight:1.12}}>{text}</div>
    {subtitle && <div style={{...rise(frame,fps,u,0.3), color:theme.muted, fontSize:u*4.4, marginTop:u*3}}>{subtitle}</div>}
  </Backdrop>;
};

const ChapterScreen = ({number, title, subtitle, theme}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit();
  return <Backdrop theme={theme}>
    {number!==undefined && <div style={{...rise(frame,fps,u), color:theme.accent, fontWeight:900, fontSize:u*26, lineHeight:1}}>{String(number).padStart(2,"0")}</div>}
    <div style={{height:u*1, width:`${ease(frame,fps,0.15)*40}%`, background:theme.highlight, margin:`${u*3}px 0`}}/>
    <div style={{...rise(frame,fps,u,0.25), fontWeight:800, fontSize:fitSize(title,u*7.5,width), lineHeight:1.12}}>{title}</div>
    {subtitle && <div style={{...rise(frame,fps,u,0.4), color:theme.muted, fontSize:u*4.2, marginTop:u*2.4}}>{subtitle}</div>}
  </Backdrop>;
};

const QuoteScreen = ({quote, author, theme}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const u=useUnit();
  return <Backdrop theme={theme}>
    <div style={{...rise(frame,fps,u), color:theme.accent, fontFamily:"Georgia, serif", fontSize:u*34, lineHeight:0.6, height:u*14}}>“</div>
    <div style={{...rise(frame,fps,u,0.15), fontFamily:"Georgia, serif", fontStyle:"italic", fontSize:u*6.4, lineHeight:1.25}}>{quote}</div>
    {author && <div style={{...rise(frame,fps,u,0.4), color:theme.muted, fontWeight:700, fontSize:u*4, marginTop:u*4}}>— {author}</div>}
  </Backdrop>;
};

const ListScreen = ({title, items=[], icon="check", color, theme, duration}) => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const u=useUnit();
  const step=Math.min(0.5,Math.max(0.15,(duration/fps-1.2)/Math.max(1,items.length)));
  return <Backdrop theme={theme} style={{alignItems:"stretch"}}>
    {title && <div style={{...rise(frame,fps,u), fontWeight:800, fontSize:u*7, marginBottom:u*5}}>{title}</div>}
    {items.map((item,i)=><div key={i} style={{...rise(frame,fps,u,0.35+i*step,0), transform:`translateX(${(1-ease(frame,fps,0.35+i*step))*-u*10}px)`, display:"flex", alignItems:"center", gap:u*2.4, textAlign:"left", background:"rgba(255,255,255,.07)", borderRadius:u*2, padding:`${u*2}px ${u*2.6}px`, marginBottom:u*2, fontSize:u*4.6, fontWeight:700}}>
      <div style={{background:color??theme.accent, borderRadius:"50%", padding:u*1}}><Icon name={icon} size={u*4.4} color="#fff" stroke={2.8}/></div>{item}
    </div>)}
  </Backdrop>;
};

const StatScreen = ({value, prefix="", suffix="", label, note, decimals=0, locale, seconds=1.4, theme}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit(); const n=useCount(value,0.2,seconds);
  const full=`${prefix}${formatNumber(value,decimals,locale)}${suffix}`;
  return <Backdrop theme={theme}>
    <div style={{...rise(frame,fps,u), color:theme.highlight, fontWeight:900, fontSize:fitSize(full,u*22,width,0.6), lineHeight:1}}>{prefix}{formatNumber(n,decimals,locale)}{suffix}</div>
    {label && <div style={{...rise(frame,fps,u,0.3), fontWeight:800, fontSize:u*6, marginTop:u*3}}>{label}</div>}
    {note && <div style={{...rise(frame,fps,u,0.6), color:theme.muted, fontSize:u*4, marginTop:u*2.4}}>{note}</div>}
  </Backdrop>;
};

const ComparePanel = ({side, color, u, offset, theme}) => <div style={{flex:1, alignSelf:"stretch", background:"rgba(255,255,255,.07)", borderTop:`${u*1}px solid ${color}`, borderRadius:u*2.4, padding:u*3.4, transform:offset, textAlign:"left", display:"flex", flexDirection:"column", justifyContent:"center"}}>
  <div style={{color, fontWeight:900, fontSize:u*5.6, marginBottom:u*1.6}}>{side.label}</div>
  {side.text && <div style={{fontSize:u*4.2, color:theme.text}}>{side.text}</div>}
  {(side.items??[]).map((t,i)=><div key={i} style={{fontSize:u*4.2, marginTop:u*1}}>• {t}</div>)}
</div>;

const CompareScreen = ({title, left={}, right={}, theme}) => {
  const frame=useCurrentFrame(); const {fps, width, height}=useVideoConfig(); const u=useUnit();
  const row=width>height, a=ease(frame,fps,0.15), b=ease(frame,fps,0.35), vs=pop(frame,fps,0.55);
  const slide=(p,dir)=>row ? `translateX(${(1-p)*dir*u*20}px)` : `translateY(${(1-p)*dir*u*20}px)`;
  return <Backdrop theme={theme}>
    {title && <div style={{...rise(frame,fps,u), fontWeight:800, fontSize:u*6.4, marginBottom:u*4}}>{title}</div>}
    <div style={{display:"flex", flexDirection:row?"row":"column", alignItems:"center", gap:u*3, width:"100%", flex:row?undefined:1, maxHeight:row?undefined:"70%"}}>
      <div style={{flex:1, width:"100%", display:"flex", opacity:a}}><ComparePanel side={left} color={left.color??"#ef4444"} u={u} offset={slide(a,-1)} theme={theme}/></div>
      <div style={{background:theme.highlight, color:"#111", fontWeight:900, fontSize:u*5, borderRadius:"50%", width:u*14, height:u*14, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transform:`scale(${vs})`}}>VS</div>
      <div style={{flex:1, width:"100%", display:"flex", opacity:b}}><ComparePanel side={right} color={right.color??"#22c55e"} u={u} offset={slide(b,1)} theme={theme}/></div>
    </div>
  </Backdrop>;
};

const clean = w => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
const KineticScreen = ({text="", highlight=[], theme, duration}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit();
  const words=text.split(/\s+/).filter(Boolean), marked=new Set(highlight.map(clean));
  const step=Math.min(0.28,(duration/fps*0.6)/Math.max(1,words.length));
  return <Backdrop theme={theme}><div style={{fontWeight:900, fontSize:fitSize(text,u*9.5,width,0.9), lineHeight:1.15, textTransform:"uppercase"}}>
    {words.map((w,i)=>{ const p=pop(frame,fps,0.1+i*step); return <span key={i} style={{display:"inline-block", margin:`0 ${u*1.2}px`, opacity:Math.min(1,p), transform:`scale(${p})`, color:marked.has(clean(w))?theme.highlight:theme.text}}>{w}</span>; })}
  </div></Backdrop>;
};

const BreakingScreen = ({label="Breaking", title, text, ticker, color="#e11d2e", theme}) => {
  const frame=useCurrentFrame(); const {fps, width}=useVideoConfig(); const u=useUnit();
  const band=ease(frame,fps);
  return <Backdrop theme={theme} style={{background:"linear-gradient(160deg, #14060a 0%, #3a0a12 100%)"}}>
    <div style={{background:color, color:"#fff", fontWeight:900, fontSize:u*5.4, textTransform:"uppercase", letterSpacing:u*0.4, padding:`${u*1.6}px ${u*4}px`, transform:`rotate(-3deg) scaleX(${band})`, marginBottom:u*5, display:"flex", alignItems:"center", gap:u*1.6}}>
      <Icon name="alert" size={u*6} color="#fff" stroke={2.6}/>{label}
    </div>
    {title && <div style={{...rise(frame,fps,u,0.25), fontWeight:900, fontSize:fitSize(title,u*8,width,0.66), lineHeight:1.1}}>{title}</div>}
    {text && <div style={{...rise(frame,fps,u,0.45), color:"#f3c9cf", fontSize:u*4.4, marginTop:u*3}}>{text}</div>}
    {ticker && <div style={{position:"absolute", left:0, right:0, bottom:"6%", background:"rgba(0,0,0,.6)", overflow:"hidden", whiteSpace:"nowrap", padding:`${u*1.4}px 0`, fontWeight:700, fontSize:u*3.8}}>
      <div style={{display:"inline-block", transform:`translateX(${100-frame/fps*u*30}px)`}}>{ticker}</div>
    </div>}
  </Backdrop>;
};

// Designed for horizontal video (side by side); both stack into a column in vertical video.
const SplitScreen = ({kicker, title, text, icon="bulb", value, prefix="", suffix="", decimals=0, locale, label, side="left", color, theme}) => {
  const frame=useCurrentFrame(); const {fps, width, height}=useVideoConfig(); const u=useUnit();
  const row=width>height, c=color??theme.accent, colWidth=row?width/2:width, n=useCount(value??0,0.3,1.4), s=pop(frame,fps,0.35);
  const words=<div key="text" style={{flex:1, textAlign:"left"}}>
    {kicker && <div style={{...rise(frame,fps,u), color:c, fontWeight:800, fontSize:u*3.8, letterSpacing:u*0.4, textTransform:"uppercase", marginBottom:u*2}}>{kicker}</div>}
    {title && <div style={{...rise(frame,fps,u,0.1), fontWeight:800, fontSize:fitSize(title,u*7.5,colWidth), lineHeight:1.1}}>{title}</div>}
    {text && <div style={{...rise(frame,fps,u,0.3), color:theme.muted, fontSize:u*4, marginTop:u*2.4, lineHeight:1.35}}>{text}</div>}
  </div>;
  const visual=<div key="visual" style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", transform:`scale(${s})`}}>
    {value!==undefined
      ? <div style={{color:theme.highlight, fontWeight:900, fontSize:fitSize(`${prefix}${formatNumber(value,decimals,locale)}${suffix}`,u*20,colWidth,0.6), lineHeight:1}}>{prefix}{formatNumber(n,decimals,locale)}{suffix}</div>
      : <div style={{background:c, borderRadius:"50%", padding:u*5, boxShadow:"0 10px 30px rgba(0,0,0,.4)"}}><Icon name={icon} size={u*22} color="#fff" stroke={2}/></div>}
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
    {title && <div style={{...rise(frame,fps,u), fontWeight:800, fontSize:u*6.4, marginBottom:u*6}}>{title}</div>}
    <div style={{position:"relative", display:"flex", flexDirection:row?"row":"column", width:"100%", gap:u*3}}>
      <div style={{position:"absolute", background:"rgba(255,255,255,.15)", ...track}}><div style={{background:c, width:row?`${line*100}%`:"100%", height:row?"100%":`${line*100}%`}}/></div>
      {list.map((s,i)=>{ const p=pop(frame,fps,0.3+i*step), q=ease(frame,fps,0.4+i*step); return <div key={i} style={{flex:1, display:"flex", flexDirection:row?"column":"row", alignItems:"center", gap:u*2.4, textAlign:row?"center":"left", position:"relative"}}>
        <div style={{width:u*10, height:u*10, borderRadius:"50%", background:c, color:"#fff", fontWeight:900, fontSize:u*4.4, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:"0 6px 18px rgba(0,0,0,.35)", transform:`scale(${p})`}}>{i+1}</div>
        <div style={{opacity:q, transform:`translateY(${(1-q)*u*3}px)`}}>
          <div style={{fontWeight:800, fontSize:u*4.4}}>{s.label}</div>
          {s.text && <div style={{color:theme.muted, fontSize:u*3.2, marginTop:u*0.8}}>{s.text}</div>}
        </div>
      </div>; })}
    </div>
  </Backdrop>;
};

export const SCREENS = {title:TitleScreen, chapter:ChapterScreen, quote:QuoteScreen, list:ListScreen, stat:StatScreen, compare:CompareScreen, kinetic:KineticScreen, breaking:BreakingScreen, split:SplitScreen, timeline:TimelineScreen};

// Dispatchers used by Video.jsx; `duration` is the item length in frames. Unknown types fail loudly in Studio.
const pick = (registry, kind, type) => {
  const Component=registry[type];
  if (!Component) throw new Error(`Unknown ${kind} type "${type}". Available: ${Object.keys(registry).join(", ")}`);
  return Component;
};
export const Overlay = ({item, duration, theme}) => {
  const {start, end, type="callout", theme:own, ...props}=item;
  const Component=pick(OVERLAYS,"overlay",type);
  return <Component {...props} duration={duration} theme={{...defaultTheme, ...theme, ...own}}/>;
};
export const Screen = ({item, duration, theme}) => {
  const {start, end, type="title", theme:own, ...props}=item;
  const Component=pick(SCREENS,"screen",type);
  const frame=useCurrentFrame(); const {fps}=useVideoConfig();
  const fade=Math.max(1,Math.min(Math.round(0.2*fps),Math.floor(duration/2)));
  const opacity=Math.min(interpolate(frame,[0,fade],[0,1],clamp),interpolate(frame,[duration-fade,duration],[1,0],clamp));
  return <AbsoluteFill style={{opacity}}><Component {...props} duration={duration} theme={{...defaultTheme, ...theme, ...own}}/></AbsoluteFill>;
};

// ---------- Gallery composition: preview of every component in Studio ----------
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
  {kind:"screen", item:{type:"title", kicker:"Special chapter", text:"The race for AI infrastructure", subtitle:"What changes in 2026"}},
  {kind:"screen", item:{type:"chapter", number:2, title:"How it works", subtitle:"Step by step"}},
  {kind:"screen", item:{type:"quote", quote:"The best way to predict the future is to invent it.", author:"Alan Kay"}},
  {kind:"screen", item:{type:"list", title:"Three keys", items:["Clean data","Smaller models","Constant evaluation"]}},
  {kind:"screen", item:{type:"stat", value:93.5, decimals:1, suffix:"%", label:"accuracy", note:"against 78% for the previous model"}},
  {kind:"screen", item:{type:"compare", title:"Before vs. now", left:{label:"Before", items:["Hours of rendering","Manual editing"]}, right:{label:"Now", items:["Minutes","Automatic plan"]}}},
  {kind:"screen", item:{type:"kinetic", text:"This changes everything for developers", highlight:["everything"]}},
  {kind:"screen", item:{type:"breaking", title:"The new model ships", text:"Available today", ticker:"Faster · Cheaper · Open source · Available in the terminal"}},
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
