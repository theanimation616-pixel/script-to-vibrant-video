import type { FFmpeg } from "@ffmpeg/ffmpeg";

export type Shot = { url: string; start: number; end: number };

import wasmAsset from "../assets/ffmpeg-core.wasm.asset.json";

const CORE_JS = "/ffmpeg/ffmpeg-core.esm.js";

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

/**
 * Builds an mp4 where each image is held for exactly its timestamp window.
 */
export async function buildVideo(
  shots: Shot[],
  onProgress: (pct: number, note: string) => void,
): Promise<Blob> {
  onProgress(2, "Loading video engine…");
  const ff = await getFFmpeg();

  const lines: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(s.url)}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const name = `img${String(i).padStart(5, "0")}.png`;
    await ff.writeFile(name, buf);
    const dur = Math.max(0.5, s.end - s.start);
    lines.push(`file '${name}'`, `duration ${dur.toFixed(3)}`);
    onProgress(2 + Math.round((i / shots.length) * 48), `Preparing frame ${i + 1}/${shots.length}`);
  }
  // concat demuxer needs the last image repeated
  lines.push(`file 'img${String(shots.length - 1).padStart(5, "0")}.png'`);
  await ff.writeFile("list.txt", new TextEncoder().encode(lines.join("\n")));

  onProgress(55, "Encoding video…");
  ff.on("progress", ({ progress }) => {
    const p = 55 + Math.min(43, Math.round(progress * 43));
    onProgress(p, "Encoding video…");
  });

  await ff.exec([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "list.txt",
    "-vsync",
    "vfr",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "26",
    "out.mp4",
  ]);

  const data = (await ff.readFile("out.mp4")) as Uint8Array;
  onProgress(100, "Video ready");
  return new Blob([data.slice().buffer as ArrayBuffer], { type: "video/mp4" });
}
