import { describe, expect, it } from "vitest";
import { NEWS, shouldShow, videoUrl, youtubeId } from "./whatsNew";

const listed = NEWS[0].version;

describe("what's new", () => {
  it("shows after an update until closed, never on a first install", () => {
    expect(shouldShow(listed, "0.5.4", true)).toBe(true);
    expect(shouldShow(listed, listed, true)).toBe(false);
    // Used Rafiq before the dialog existed (a model added): an update.
    expect(shouldShow(listed, null, true)).toBe(true);
    // A brand new install: the welcome covers it.
    expect(shouldShow(listed, null, false)).toBe(false);
  });

  it("stays quiet for a version with nothing listed", () => {
    expect(shouldShow("9.9.9", "0.5.4", true)).toBe(false);
  });

  it("knows a YouTube link from a video file", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://github.com/x/y/releases/download/v1/whats-new.mp4")).toBeNull();
  });

  it("plays the video in the app's language, or the Arabic one", () => {
    const news = { version: "9.9.9", title: () => "", points: () => [], videos: { ar: "ar.mp4", en: "en.mp4" } };
    expect(videoUrl(news, "en")).toBe("en.mp4");
    expect(videoUrl(news, "ru")).toBe("ar.mp4");
  });
});
