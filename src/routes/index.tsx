import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState } from "react";
import { analyzeScript, promptsForBatch, renderImage } from "@/lib/manga.functions";
import { fmt, type Segment } from "@/lib/script";
import { buildVideo } from "@/lib/video";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Script to Manga — AI Manga Video Generator" },
      {
        name: "description",
        content:
          "Turn a timestamped script into a sequence of consistent 16:9 manga panels and export a finished video.",
      },
      { property: "og:title", content: "Script to Manga — AI Manga Video Generator" },
      {
        property: "og:description",
        content:
          "Upload a timestamped script, get one manga panel per timestamp and a downloadable video.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Shot = Segment & {
  prompt?: string | undefined;
  url?: string | undefined;
  status: "waiting" | "prompting" | "drawing" | "done" | "error";
  error?: string | undefined;
};

const SAMPLE = `(0:00)Henan की कहानी असुरा का उदय. Henan नाम का एक साधारण लड़का था. (0:05)

वह Mumbai के एक पुराने building की छोटी सी किराए की कोठरी में रहता था. (0:09)

कमरा इतना छोटा था कि एक बिस्तर, एक छोटी अलमारी और एक खिड़की के अलावा कुछ जगह ही नहीं बचती थी. (0:16)`;

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx] as T);
    }
  });
  await Promise.all(workers);
}

function Index() {
  const analyze = useServerFn(analyzeScript);
  const getPrompts = useServerFn(promptsForBatch);
  const draw = useServerFn(renderImage);

  const [script, setScript] = useState("");
  const [bible, setBible] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [phase, setPhase] = useState<"idle" | "running" | "video" | "done" | "error">("idle");
  const [note, setNote] = useState("");
  const [videoPct, setVideoPct] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doneCount = shots.filter((s) => s.status === "done").length;
  const failed = shots.filter((s) => s.status === "error");
  const pct = shots.length ? Math.round((doneCount / shots.length) * 100) : 0;

  const stats = useMemo(
    () => ({ chars: script.length, words: script.trim() ? script.trim().split(/\s+/).length : 0 }),
    [script],
  );

  const patch = useCallback((index: number, next: Partial<Shot>) => {
    setShots((prev) => prev.map((s) => (s.index === index ? { ...s, ...next } : s)));
  }, []);

  async function run() {
    setError(null);
    setVideoUrl(null);
    setPhase("running");
    setNote("Reading script and locking character designs…");
    try {
      const { segments, bible: b } = await analyze({ data: { script } });
      setBible(b);
      let list: Shot[] = segments.map((s) => ({ ...s, status: "waiting" as const }));
      setShots(list);

      // 1. prompts, in batches (handles very long scripts)
      const BATCH = 8;
      const batches: Segment[][] = [];
      for (let i = 0; i < segments.length; i += BATCH) batches.push(segments.slice(i, i + BATCH));

      let batchDone = 0;
      await pool(batches, 2, async (batch) => {
        batch.forEach((s) => patch(s.index, { status: "prompting" }));
        try {
          const { prompts } = await getPrompts({ data: { bible: b, segments: batch } });
          batch.forEach((s, i) => patch(s.index, { prompt: prompts[i] as string }));
          list = list.map((s) => {
            const at = batch.findIndex((x) => x.index === s.index);
            return at === -1 ? s : { ...s, prompt: prompts[at] as string };
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          batch.forEach((s) => patch(s.index, { status: "error", error: msg }));
        }
        batchDone++;
        setNote(`Writing prompts… ${Math.min(batchDone * BATCH, segments.length)}/${segments.length}`);
      });

      // 2. images, in sequence-safe parallel pool
      let drawn = 0;
      await pool(list, 3, async (shot) => {
        const prompt = shot.prompt;
        if (!prompt) return;
        patch(shot.index, { status: "drawing" });
        try {
          const { url } = await draw({ data: { prompt, seed: 1000 + shot.index } });
          patch(shot.index, { url, status: "done" });
          list = list.map((s) => (s.index === shot.index ? { ...s, url, status: "done" } : s));
        } catch (e) {
          patch(shot.index, {
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
        drawn++;
        setNote(`Drawing panels… ${drawn}/${list.length}`);
      });

      setPhase("done");
      setNote("All panels generated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function retryFailed() {
    setPhase("running");
    await pool(failed, 2, async (shot) => {
      patch(shot.index, { status: "drawing" });
      try {
        let prompt = shot.prompt;
        if (!prompt) {
          const { prompts } = await getPrompts({ data: { bible, segments: [shot] } });
          prompt = prompts[0] as string;
          patch(shot.index, { prompt });
        }
        const { url } = await draw({ data: { prompt, seed: 7000 + shot.index } });
        patch(shot.index, { url, status: "done", error: undefined });
      } catch (e) {
        patch(shot.index, { status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    });
    setPhase("done");
  }

  async function makeVideo() {
    setPhase("video");
    setVideoPct(0);
    try {
      const ready = shots
        .filter((s) => s.url)
        .sort((a, b) => a.start - b.start)
        .map((s) => ({ url: s.url as string, start: s.start, end: s.end, prompt: s.prompt }));
      const blob = await buildVideo(ready, (p, n) => {
        setVideoPct(p);
        setNote(n);
      });
      setVideoUrl(URL.createObjectURL(blob));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then(setScript);
  }

  const busy = phase === "running" || phase === "video";

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-5xl">
        <header className="border-b-4 border-foreground pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.4em] text-accent-foreground">
            AI Manga Studio
          </p>
          <h1 className="mt-2 font-display text-5xl font-black uppercase leading-none tracking-tight">
            Script → Manga Video
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Paste a timestamped script. Every <span className="font-semibold">(m:ss)</span> window
            becomes one fixed-style 16:9 manga panel with consistent characters, then everything is
            cut into a downloadable video.
          </p>
        </header>

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="font-display text-lg font-bold uppercase">Your script</label>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {stats.chars.toLocaleString()} chars · {stats.words.toLocaleString()} words
              </span>
              <button
                onClick={() => setScript(SAMPLE)}
                className="rounded-none border-2 border-foreground px-3 py-1 font-semibold uppercase hover:bg-foreground hover:text-background"
              >
                Sample
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-none border-2 border-foreground px-3 py-1 font-semibold uppercase hover:bg-foreground hover:text-background"
              >
                Upload .txt
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,text/plain"
                onChange={onFile}
                className="hidden"
              />
            </div>
          </div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={12}
            spellCheck={false}
            placeholder="(0:00)पहली लाइन... (0:05)&#10;&#10;दूसरी लाइन... (0:09)"
            className="mt-3 w-full resize-y border-2 border-foreground bg-card p-4 font-mono text-sm outline-none focus:ring-4 focus:ring-ring"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              disabled={busy || script.trim().length < 10}
              onClick={run}
              className="border-4 border-foreground bg-primary px-6 py-3 font-display text-lg font-black uppercase text-primary-foreground shadow-[6px_6px_0_0_var(--color-foreground)] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[3px_3px_0_0_var(--color-foreground)] disabled:opacity-40"
            >
              {busy ? "Working…" : "Generate manga"}
            </button>
            {failed.length > 0 && !busy && (
              <button
                onClick={retryFailed}
                className="border-4 border-foreground bg-destructive px-6 py-3 font-display text-lg font-black uppercase text-destructive-foreground"
              >
                Retry {failed.length} failed
              </button>
            )}
            {doneCount > 0 && !busy && (
              <button
                onClick={makeVideo}
                className="border-4 border-foreground bg-accent px-6 py-3 font-display text-lg font-black uppercase text-accent-foreground"
              >
                Build video
              </button>
            )}
          </div>
        </section>

        {(shots.length > 0 || busy) && (
          <section className="mt-8 border-4 border-foreground bg-card p-5">
            <div className="flex items-center justify-between font-mono text-xs uppercase">
              <span>{note || "Ready"}</span>
              <span>
                {doneCount}/{shots.length} panels
              </span>
            </div>
            <div className="mt-3 h-4 w-full border-2 border-foreground">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${phase === "video" ? videoPct : pct}%` }}
              />
            </div>
            {bible && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-display font-bold uppercase">
                  Character consistency sheet (text only — never drawn)
                </summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                  {bible}
                </pre>
              </details>
            )}
          </section>
        )}

        {error && (
          <p className="mt-4 border-2 border-destructive bg-destructive/10 p-3 text-sm">{error}</p>
        )}

        {videoUrl && (
          <section className="mt-8 border-4 border-foreground bg-card p-5">
            <h2 className="font-display text-2xl font-black uppercase">Your video</h2>
            <video src={videoUrl} controls className="mt-3 w-full border-2 border-foreground" />
            <a
              href={videoUrl}
              download="manga-video.mp4"
              className="mt-3 inline-block border-4 border-foreground bg-primary px-5 py-2 font-display font-black uppercase text-primary-foreground"
            >
              Download mp4
            </a>
          </section>
        )}

        {shots.length > 0 && (
          <section className="mt-8 grid gap-5 sm:grid-cols-2">
            {shots.map((s) => (
              <article key={s.index} className="border-4 border-foreground bg-card">
                <div className="flex items-center justify-between border-b-2 border-foreground px-3 py-2 font-mono text-xs uppercase">
                  <span>
                    #{s.index + 1} · {fmt(s.start)} → {fmt(s.end)}
                  </span>
                  <span
                    className={
                      s.status === "error" ? "text-destructive" : "text-muted-foreground"
                    }
                  >
                    {s.status}
                  </span>
                </div>
                <div className="aspect-video w-full bg-muted">
                  {s.url ? (
                    <img
                      src={s.url}
                      alt={`Manga panel ${s.index + 1}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
                      {s.status === "error" ? "failed" : "…"}
                    </div>
                  )}
                </div>
                <p className="border-t-2 border-foreground p-3 text-xs text-muted-foreground">
                  {s.text}
                </p>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
