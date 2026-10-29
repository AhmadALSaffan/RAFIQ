/**
 * Listening for one spoken sentence in the voice conversation: recording starts at once and
 * stops by itself a moment after the user stops talking — no button to press.
 */

/** Loudness (RMS of the samples, 0–1) above which it counts as speech. */
export const SPEECH_LEVEL = 0.025;
/** How long the user must be quiet after speaking for the sentence to be over. */
export const SILENCE_MS = 1300;
/** Speech shorter than this is a cough or a click, not a sentence. */
export const MIN_SPEECH_MS = 250;
/** One sentence never runs longer than this. */
export const MAX_MS = 60_000;

/**
 * Decides when a sentence is over from a stream of loudness readings. "wait" until the
 * user has spoken and then been quiet long enough; "done" then. Quiet before any speech
 * never ends it — the user may take a moment to start.
 */
export class SentenceEnd {
  private started: number | null = null;
  private spoken = 0;
  private lastLoud = 0;
  private lastAt: number | null = null;

  feed(level: number, now: number): "wait" | "done" {
    if (this.started === null) this.started = now;
    const step = this.lastAt === null ? 0 : now - this.lastAt;
    this.lastAt = now;
    if (level >= SPEECH_LEVEL) {
      this.spoken += step;
      this.lastLoud = now;
    }
    if (now - this.started >= MAX_MS && this.spoken >= MIN_SPEECH_MS) return "done";
    if (this.spoken >= MIN_SPEECH_MS && now - this.lastLoud >= SILENCE_MS) return "done";
    return "wait";
  }

  /** Whether anything worth sending was said. */
  get heard(): boolean {
    return this.spoken >= MIN_SPEECH_MS;
  }
}

/**
 * Records until the sentence is over (or `signal` aborts). Resolves to the recording, or
 * null when nothing was said. `onLevel` gets the loudness, for a moving meter.
 */
export async function listenOnce(signal: AbortSignal, onLevel?: (level: number) => void): Promise<Blob | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const recorder = new MediaRecorder(stream);
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const end = new SentenceEnd();

  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      let timer = 0;
      const finish = (keep: boolean) => {
        window.clearInterval(timer);
        recorder.onstop = () => resolve(keep && end.heard ? new Blob(parts, { type: recorder.mimeType || "audio/webm" }) : null);
        if (recorder.state !== "inactive") recorder.stop();
        else resolve(null);
      };
      signal.addEventListener("abort", () => finish(false), { once: true });
      recorder.onerror = () => reject(new Error("recorder"));
      recorder.start(250);
      timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) sum += s * s;
        const level = Math.sqrt(sum / samples.length);
        onLevel?.(level);
        if (end.feed(level, performance.now()) === "done") finish(true);
      }, 50);
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  }
}
