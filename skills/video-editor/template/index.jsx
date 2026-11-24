import React from "react";
import {registerRoot, Composition} from "remotion";
import config from "./edit";
import {EditedVideo, durationInFrames} from "./Video";
import {Gallery, galleryDuration, horizontalGallery, ThemeSheet, ThemeReel, themeReelDuration} from "./components";

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
  {/* Theme pickers: one still with every preset (both orientations) and an animated tour. */}
  <Composition id="ThemeSheet" component={ThemeSheet} width={1920} height={1080} fps={config.fps} durationInFrames={1} />
  <Composition id="ThemeSheetVertical" component={ThemeSheet} width={1080} height={1920} fps={config.fps} durationInFrames={1} />
  <Composition id="Themes" component={ThemeReel}
    width={config.width} height={config.height} fps={config.fps}
    durationInFrames={themeReelDuration(config.fps)} />
</>;
registerRoot(Root);
