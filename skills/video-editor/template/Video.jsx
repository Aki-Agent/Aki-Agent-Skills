import React from "react";
import {AbsoluteFill, Sequence, Easing, interpolate, useCurrentFrame, useVideoConfig, staticFile} from "remotion";
import {Video} from "@remotion/media";
import {createTikTokStyleCaptions} from "@remotion/captions";
import config from "./edit";
import captions from "./captions";

const pages = createTikTokStyleCaptions({captions, combineTokensWithinMilliseconds:1200}).pages;
const toFrame = (seconds, fps) => Math.round(seconds * fps);
export const durationInFrames = (plan) => plan.clips.reduce((sum, clip) => sum + toFrame(clip.end, plan.fps) - toFrame(clip.start, plan.fps), 0);

const Clip = ({start}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const ms = (start + frame) * 1000 / fps;
  const page = pages.find(p => ms >= p.startMs && ms < p.startMs + p.durationMs);
  return <AbsoluteFill>
    <Video src={staticFile(config.source)} trimBefore={start} objectFit="cover" style={{width:"100%",height:"100%"}} />
    {page && <div style={{position:"absolute",bottom:"12.5%",left:"4%",right:"4%",textAlign:"center",fontFamily:"Arial, sans-serif",fontWeight:800,fontSize:config.width*0.0625,lineHeight:1.14,color:"white",textShadow:"0 2px 6px #000, 0 0 12px #000"}}>
      {page.tokens.map((token,i)=><span key={i} style={{color:ms>=token.fromMs && ms<token.toMs ? "#ffe456":"white"}}>{token.text}</span>)}
    </div>}
  </AbsoluteFill>;
};

export const EditedVideo = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  let offset = 0;
  let scale = 1;
  for (const z of config.zooms) {
    const a=toFrame(z.start,fps), b=toFrame(z.end,fps), ramp=Math.max(1,Math.min(toFrame(z.ramp ?? 0.4,fps),Math.floor((b-a)/2)));
    if (frame>=a && frame<b) {
      const options={extrapolateLeft:"clamp",extrapolateRight:"clamp",easing:Easing.inOut(Easing.ease)};
      const enter=interpolate(frame,[a,a+ramp],[0,1],options);
      const exit=interpolate(frame,[b-ramp,b],[1,0],options);
      scale=1+(z.scale-1)*Math.min(enter,exit);
    }
  }
  return <AbsoluteFill style={{backgroundColor:"#000"}}>
    <AbsoluteFill style={{transform:`scale(${scale})`}}>
      {config.clips.map((clip,i)=>{
        const from=offset, start=toFrame(clip.start,fps), length=toFrame(clip.end,fps)-start;
        offset+=length;
        return <Sequence key={i} name={`Clip ${i+1}`} from={from} durationInFrames={length}><Clip start={start}/></Sequence>;
      })}
    </AbsoluteFill>
    {config.overlays.map((item,i)=><Sequence key={i} name={`Overlay ${i+1}`} from={toFrame(item.start,fps)} durationInFrames={toFrame(item.end,fps)-toFrame(item.start,fps)}>
      <div style={{position:"absolute",top:"7%",left:"5%",background:"#112b52",color:"#fff",font:`bold ${config.width*0.042}px Arial`,padding:"2% 3%",borderRadius:12}}>{item.text}</div>
    </Sequence>)}
    {config.screens.map((item,i)=><Sequence key={i} name={`Screen ${i+1}`} from={toFrame(item.start,fps)} durationInFrames={toFrame(item.end,fps)-toFrame(item.start,fps)}>
      <AbsoluteFill style={{background:"#0c1831",color:"white",display:"flex",justifyContent:"center",alignItems:"center",font:`bold ${config.width*0.08}px Arial`,textAlign:"center",padding:"8%",boxSizing:"border-box"}}>{item.text}</AbsoluteFill>
    </Sequence>)}
  </AbsoluteFill>;
};
