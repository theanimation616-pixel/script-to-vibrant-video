import type { FFmpeg } from "@ffmpeg/ffmpeg";

export type Shot = { url: string; start: number; end: number; prompt?: string | undefined };

import wasmAsset from "../assets/ffmpeg-core.wasm.asset.json";

const CORE_JS = "/ffmpeg/ffmpeg-core.esm.js";

const W = 1280;
const H = 720;
const FPS = 24;
/** Cross-fade length between two shots (seconds). */
const XF = 0.7;

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(onLog?: (m: string) => void): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg: FF } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ff = new FF();
      ff.on("log", ({ message }) => onLog?.(message));
      await ff.load({
        coreURL: await toBlobURL(CORE_JS, "text/javascript"),
        wasmURL: await toBlobURL(wasmAsset.url, "application/wasm"),
      });
      return ff;
    })();
  }
  return ffmpegPromise;
}

/* ------------------------------------------------------------------ */
/* Cinematography                                                      */
/* ------------------------------------------------------------------ */

/** Deterministic but shot-dependent pseudo random, so every run varies per index. */
function hash(i: number, salt: number): number {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

type Move = (frames: number) => string;

/** Ken Burns style camera moves — never the same one twice in a row. */
const MOVES: Move[] = [
  // slow push in, centered
  (n) =>
    `zoompan=z='min(1.001+${(0.18 / n).toFixed(6)}*on,1.20)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,
  // pull back, centered
  (n) =>
    `zoompan=z='max(1.22-${(0.20 / n).toFixed(6)}*on,1.001)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,
  // pan left -> right
  (n) => `zoompan=z='1.14':x='(iw-iw/zoom)*on/${n}':y='(ih-ih/zoom)/2'`,
  // pan right -> left
  (n) => `zoompan=z='1.14':x='(iw-iw/zoom)*(1-on/${n})':y='(ih-ih/zoom)/2'`,
  // tilt down
  (n) => `zoompan=z='1.14':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*on/${n}'`,
  // tilt up
  (n) => `zoompan=z='1.14':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*(1-on/${n})'`,
  // push in toward top-left (face / focal point)
  (n) =>
    `zoompan=z='min(1.02+${(0.20 / n).toFixed(6)}*on,1.24)':x='(iw-iw/zoom)*0.28':y='(ih-ih/zoom)*0.22'`,
  // push in toward bottom-right
  (n) =>
    `zoompan=z='min(1.02+${(0.20 / n).toFixed(6)}*on,1.24)':x='(iw-iw/zoom)*0.72':y='(ih-ih/zoom)*0.75'`,
  // diagonal drift with a touch of zoom
  (n) =>
    `zoompan=z='min(1.08+${(0.12 / n).toFixed(6)}*on,1.22)':x='(iw-iw/zoom)*on/${n}':y='(ih-ih/zoom)*(1-on/${n})'`,
];

const TRANSITIONS = [
  "fade",
  "dissolve",
  "smoothleft",
  "smoothright",
  "wipeleft",
  "wiperight",
  "slideup",
  "slidedown",
  "circleopen",
  "fadeblack",
  "fadewhite",
  "radial",
  "pixelize",
  "diagtl",
  "hlwind",
];

type Grade = { name: string; filter: string };

/** Cinematic color-grade looks. Colour is chosen from the shot's own content. */
const GRADES = {
  night: {
    name: "night",
    filter:
      "eq=contrast=1.14:brightness=-0.045:saturation=1.05:gamma=0.95,colorbalance=rs=-0.08:gs=-0.02:bs=0.16:rm=-0.05:bm=0.10",
  },
  sunset: {
    name: "sunset",
    filter:
      "eq=contrast=1.10:brightness=0.020:saturation=1.30,colorbalance=rs=0.14:gs=0.03:bs=-0.10:rm=0.08:bm=-0.06",
  },
  warm: {
    name: "warm",
    filter:
      "eq=contrast=1.08:brightness=0.015:saturation=1.22,colorbalance=rs=0.09:bs=-0.06:rm=0.05",
  },
  cool: {
    name: "cool",
    filter:
      "eq=contrast=1.10:brightness=0.000:saturation=1.12,colorbalance=rs=-0.06:bs=0.12:bm=0.05",
  },
  tense: {
    name: "tense",
    filter:
      "eq=contrast=1.26:brightness=-0.030:saturation=0.92,colorbalance=rs=0.05:bs=0.05:gm=-0.04",
  },
  rain: {
    name: "rain",
    filter:
      "eq=contrast=1.12:brightness=-0.020:saturation=0.95,colorbalance=rs=-0.05:gs=0.04:bs=0.14",
  },
  bright: {
    name: "bright",
    filter: "eq=contrast=1.06:brightness=0.035:saturation=1.28,colorbalance=gs=0.04:bs=0.03",
  },
  dream: {
    name: "dream",
    filter:
      "eq=contrast=1.02:brightness=0.030:saturation=1.34,colorbalance=rs=0.08:bs=0.10:rm=0.04:bm=0.05",
  },
};

const CYCLE = [GRADES.bright, GRADES.warm, GRADES.cool, GRADES.dream, GRADES.tense] as Grade[];

function gradeFor(shot: Shot, i: number): Grade {
  const t = (shot.prompt ?? "").toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has("night", "midnight", "moon", "dark room", "starlit", "streetlight"))
    return GRADES.night as Grade;
  if (has("sunset", "dusk", "golden hour", "sunrise", "dawn", "fire", "flame", "lantern"))
    return GRADES.sunset as Grade;
  if (has("rain", "storm", "wet", "monsoon", "fog", "mist")) return GRADES.rain as Grade;
  if (has("angry", "fight", "blood", "scream", "fear", "shadow", "threat", "battle"))
    return GRADES.tense as Grade;
  if (has("sunlight", "sunny", "morning", "market", "festival", "smile", "laugh"))
    return GRADES.bright as Grade;
  if (has("memory", "dream", "flashback", "sky", "hope", "magic"))
    return GRADES.dream as Grade;
  if (has("indoor", "room", "kitchen", "lamp", "warm")) return GRADES.warm as Grade;
  if (has("cold", "rooftop", "hospital", "office", "school", "train"))
    return GRADES.cool as Grade;
  return CYCLE[i % CYCLE.length] as Grade;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/**
 * Builds an mp4 where every image is one visual beat held for its own timestamp
 * window, with a unique camera move, a unique transition and a content-aware
 * color grade per shot.
 */
export async function buildVideo(
  shots: Shot[],
  onProgress: (pct: number, note: string) => void,
): Promise<Blob> {
  onProgress(2, "Loading video engine…");
  const ff = await getFFmpeg();

  const names: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(s.url)}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const name = `img${String(i).padStart(5, "0")}.png`;
    await ff.writeFile(name, buf);
    names.push(name);
    onProgress(
      2 + Math.round((i / shots.length) * 40),
      `Preparing shot ${i + 1}/${shots.length}`,
    );
  }

  const durations = shots.map((s) => Math.max(0.8, s.end - s.start));
  const n = shots.length;

  onProgress(46, "Directing camera moves…");

  const args: string[] = [];
  for (let i = 0; i < n; i++) {
    // every clip except the last is extended by the cross-fade length so the
    // shot timing on the final timeline stays true to the script timestamps
    const len = durations[i]! + (i < n - 1 ? XF : 0);
    args.push("-loop", "1", "-framerate", String(FPS), "-t", len.toFixed(3), "-i", names[i]!);
  }

  const chains: string[] = [];
  let lastMove = -1;
  for (let i = 0; i < n; i++) {
    const len = durations[i]! + (i < n - 1 ? XF : 0);
    const frames = Math.max(2, Math.round(len * FPS));

    let mi = Math.floor(hash(i, 3) * MOVES.length) % MOVES.length;
    if (mi === lastMove) mi = (mi + 1 + Math.floor(hash(i, 9) * 3)) % MOVES.length;
    lastMove = mi;

    const grade = gradeFor(shots[i]!, i);
    const vig = 0.9 + hash(i, 17) * 0.5;

    chains.push(
      `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,` +
        `crop=${W * 2}:${H * 2},setsar=1,` +
        `${MOVES[mi]!(frames)}:d=1:s=${W}x${H}:fps=${FPS},` +
        `${grade.filter},vignette=PI/${vig.toFixed(2)},` +
        `unsharp=5:5:0.6:5:5:0.0,format=yuv420p[v${i}]`,
    );
  }

  // chain the clips with a different transition every time
  let outLabel = "v0";
  let offset = 0;
  for (let i = 1; i < n; i++) {
    offset += durations[i - 1]!;
    let ti = Math.floor(hash(i, 31) * TRANSITIONS.length) % TRANSITIONS.length;
    if (i > 1) {
      const prev = Math.floor(hash(i - 1, 31) * TRANSITIONS.length) % TRANSITIONS.length;
      if (ti === prev) ti = (ti + 3) % TRANSITIONS.length;
    }
    const next = `x${i}`;
    chains.push(
      `[${outLabel}][v${i}]xfade=transition=${TRANSITIONS[ti]}:duration=${XF}:offset=${offset.toFixed(3)}[${next}]`,
    );
    outLabel = next;
  }

  const filter = chains.join(";");

  onProgress(52, "Encoding video…");
  ff.on("progress", ({ progress }) => {
    const p = 52 + Math.min(46, Math.round(progress * 46));
    onProgress(p, "Encoding video…");
  });

  const encode = async (fc: string, label: string) => {
    await ff.exec([
      ...args,
      "-filter_complex",
      fc,
      "-map",
      `[${label}]`,
      "-r",
      String(FPS),
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-movflags",
      "+faststart",
      "out.mp4",
    ]);
  };

  try {
    await encode(filter, outLabel);
    const data = (await ff.readFile("out.mp4")) as Uint8Array;
    if (!data || data.length < 1000) throw new Error("empty output");
    onProgress(100, "Video ready");
    return new Blob([data.slice().buffer as ArrayBuffer], { type: "video/mp4" });
  } catch (e) {
    // graceful fallback: same camera moves + grade, simple concat, no xfade
    onProgress(60, "Finishing video…");
    const simple = chains
      .filter((c) => !c.includes("xfade"))
      .map((c, i) => c.replace(`[v${i}]`, `[c${i}]`))
      .join(";");
    const concat =
      simple +
      ";" +
      Array.from({ length: n }, (_, i) => `[c${i}]`).join("") +
      `concat=n=${n}:v=1:a=0[vout]`;
    await encode(concat, "vout");
    const data = (await ff.readFile("out.mp4")) as Uint8Array;
    if (!data || data.length < 1000) throw e instanceof Error ? e : new Error(String(e));
    onProgress(100, "Video ready");
    return new Blob([data.slice().buffer as ArrayBuffer], { type: "video/mp4" });
  }
}
