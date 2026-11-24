import React from "react";
import {registerRoot, Composition} from "remotion";
import config from "./edit";
import {EditedVideo, durationInFrames} from "./Video";

const Root = () => <Composition id="EditedVideo" component={EditedVideo}
  width={config.width} height={config.height} fps={config.fps}
  durationInFrames={durationInFrames(config)} />;
registerRoot(Root);
