import React from "react";
import {registerRoot, Composition} from "remotion";
import config from "./edit";
import {EditedVideo, durationInFrames} from "./Video";
import {Gallery, galleryDuration, horizontalGallery} from "./components";

const Root = () => <>
  <Composition id="EditedVideo" component={EditedVideo}
    width={config.width} height={config.height} fps={config.fps}
    durationInFrames={durationInFrames(config)} />
  <Composition id="Gallery" component={Gallery} defaultProps={{theme:config.theme}}
    width={config.width} height={config.height} fps={config.fps}
    durationInFrames={galleryDuration(config.fps)} />
  <Composition id="GalleryHorizontal" component={Gallery} defaultProps={{theme:config.theme, items:horizontalGallery}}
    width={1920} height={1080} fps={config.fps}
    durationInFrames={galleryDuration(config.fps, horizontalGallery)} />
</>;
registerRoot(Root);
