import { describe, expect, it } from "vitest";
import { avcLevel, pickEncoder, type EncoderProbe } from "./export";

/** An encoder that only takes what `accepts` says, recording what it was asked. */
function encoder(accepts: (c: VideoEncoderConfig) => boolean) {
  const asked: VideoEncoderConfig[] = [];
  const probe: EncoderProbe = async (c) => {
    asked.push(c);
    return accepts(c);
  };
  return { probe, asked };
}

describe("picking the H.264 encoder", () => {
  it("takes the GPU at High profile when it can", async () => {
    const { probe } = encoder(() => true);
    expect(await pickEncoder(1080, 1920, 30, 12_441_600, probe)).toEqual({ codec: avcLevel(1080, 1920, 30).codec, hardwareAcceleration: "prefer-hardware" });
  });

  it("falls back from a GPU that refuses portrait 1080×1920 at High — the laptop case", async () => {
    const { probe, asked } = encoder((c) => c.hardwareAcceleration !== "prefer-hardware" || !c.codec.startsWith("avc1.6400"));
    const pick = await pickEncoder(1080, 1920, 60, 12_441_600, probe);
    const level = avcLevel(1080, 1920, 60).codec.slice(-2);
    expect(asked[0].codec).toBe(`avc1.6400${level}`);
    expect(pick).toEqual({ codec: `avc1.4D00${level}`, hardwareAcceleration: "prefer-hardware" });
  });

  it("goes to software when the GPU takes nothing", async () => {
    const { probe } = encoder((c) => c.hardwareAcceleration === "prefer-software");
    expect((await pickEncoder(1920, 1080, 60, 20e6, probe))?.hardwareAcceleration).toBe("prefer-software");
  });

  it("never offers a level below what the size needs", async () => {
    const { probe, asked } = encoder(() => false);
    expect(await pickEncoder(3840, 2160, 60, 60e6, probe)).toBeNull();
    const needed = parseInt(avcLevel(3840, 2160, 60).codec.slice(-2), 16);
    for (const c of asked) expect(parseInt(c.codec.slice(-2), 16)).toBeGreaterThanOrEqual(needed);
  });
});
