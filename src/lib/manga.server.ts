import type { Segment } from "./script";

const CHAT_URL = "https://paraloncloud.com/v1/chat/completions";
const CHAT_MODEL = "qwen3.8-27b";
const PIXAZO_URL = "https://gateway.pixazo.ai/flux-1-schnell/v1/getData";

export const STYLE =
  "vibrant full-color anime manga illustration, rich saturated colour palette, cel shading with soft gradients, expressive cinematic lighting and colour, bold clean ink lines, detailed painted backgrounds, high quality anime key visual";

/**
 * Hard guards that stop the model from drawing a character reference sheet,
 * a character portrait inset, or a split/collage layout next to the scene.
 */
export const SINGLE_PANEL_GUARD =
  "ONE single full-bleed illustration of this one moment only, one continuous scene, " +
  "no character reference sheet, no character lineup, no turnaround, no inset portrait, " +
  "no side panel, no split screen, no collage, no grid, no multiple panels, no borders, " +
  "no duplicated characters, no repeated figures, no extra copies of the same person, " +
  "no text, no captions, no speech bubbles, no watermark, no logo, NOT black and white, no monochrome, no greyscale, no sepia, no screentone dots, no manga halftone, full colour";

export async function zaiChat(
  messages: { role: string; content: string }[],
  opts: {
    temperature?: number;
    model?: string;
    maxTokens?: number;
    timeoutMs?: number;
    attempts?: number;
  } = {},
): Promise<string> {
  const key = process.env["PARALON_API_KEY"];
  if (!key) throw new Error("Missing PARALON_API_KEY");

  const attempts = opts.attempts ?? 3;
  let lastErr = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 150_000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model ?? CHAT_MODEL,
          temperature: opts.temperature ?? 0.6,
          // This model always "thinks" first; the budget must cover the hidden
          // reasoning tokens or the answer comes back empty.
          max_tokens: opts.maxTokens ?? 4000,
          messages,
        }),
      });
      if (!res.ok) {
        lastErr = `${res.status} ${await res.text().catch(() => "")}`.slice(0, 300);
        if (res.status === 400 || res.status === 401 || res.status === 403) break;
      } else {
        const json = (await res.json()) as {
          choices?: { message?: { content?: string; reasoning?: string } }[];
        };
        const msg = json.choices?.[0]?.message;
        const text = msg?.content?.trim() || extractFromReasoning(msg?.reasoning);
        if (text) return text;
        lastErr = "empty completion";
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    // 502/504 come from the provider's edge (HTML body), not the model:
    // back off progressively instead of failing the whole batch.
    if (attempt < attempts - 1)
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  throw new Error(`Text model request failed: ${lastErr}`);
}

/** Last-resort salvage: pull a JSON array out of truncated reasoning text. */
function extractFromReasoning(reasoning?: string): string | null {
  if (!reasoning) return null;
  const start = reasoning.indexOf("[");
  const end = reasoning.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  const slice = reasoning.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as unknown;
    return Array.isArray(parsed) ? slice : null;
  } catch {
    return null;
  }
}


function stripFences(s: string): string {
  return s
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

export function parseJsonArray(raw: string): unknown[] {
  const text = stripFences(raw);
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Model did not return a JSON array");
  return JSON.parse(text.slice(start, end + 1)) as unknown[];
}

/** Builds a compact, reusable character bible from the whole script. */
export async function buildCharacterBible(script: string): Promise<string> {
  const sample =
    script.length > 24000
      ? script.slice(0, 12000) + "\n...\n" + script.slice(-12000)
      : script;

  const out = await zaiChat(
    [
      {
        role: "system",
        content:
          "You are a manga art director. Read the script (it may be Hinglish/Hindi) and list the recurring characters. " +
          "For each, give ONE compact English line of fixed visual traits usable inside an image prompt: " +
          "age, gender, hair, eyes, face, build, signature clothing. Max 6 characters. " +
          "Output plain lines like: Henan: 17-year-old Indian boy, messy black hair, sharp dark eyes, thin build, faded grey school shirt. " +
          "No headings, no numbering, no extra commentary. Do not deliberate — answer immediately.",
      },
      { role: "user", content: sample },
    ],
    { maxTokens: 2500, timeoutMs: 120_000 },
  );
  return stripFences(out).slice(0, 2000);
}


/** Writes one image prompt per segment, in batches. */
export async function writePrompts(
  bible: string,
  segments: Segment[],
): Promise<string[]> {
  const numbered = segments
    .map((s, i) => `${i + 1}. [${s.start}s-${s.end}s] ${s.text}`)
    .join("\n");

  const raw = await zaiChat(
    [
      {
        role: "system",
        content:
          "You write image prompts for a manga storyboard. Input: a character bible and numbered script lines " +
          "(Hindi/Hinglish). For EACH numbered line write ONE English image prompt describing a SINGLE cinematic " +
          "moment from that line: who is in frame, their action and expression, the setting, the camera angle, and the LIGHTING + COLOUR palette (e.g. 'warm golden sunset light, amber and teal palette'). Each prompt is ONE meaningful visual beat: one shot, one moment.\n" +
          "RULES:\n" +
          "- Weave a character's fixed traits INLINE into the sentence (e.g. 'Henan, a thin 17-year-old boy with messy black hair, sits...'). " +
          "NEVER write a separate character description block, character sheet, reference, lineup, or 'plus portrait of'.\n" +
          "- Exactly one scene, one moment, one instance of each character. Never ask for multiple panels, insets, collages or side-by-side views.\n" +
          "- Always full colour. Never describe the image as black and white, monochrome, greyscale or screentone.\n- No text, letters, captions or speech bubbles in the image.\n" +
          "- 35 to 60 words each. English only.\n" +
          "- Do not deliberate or explain. Output the JSON array immediately.\n" +
          'Return ONLY a JSON array of strings, one per numbered line, in order.',
      },
      {
        role: "user",
        content: `CHARACTER BIBLE:\n${bible}\n\nSCRIPT LINES:\n${numbered}\n\nReturn a JSON array with exactly ${segments.length} prompt strings.`,
      },
    ],
    {
      temperature: 0.7,
      maxTokens: 1200 + segments.length * 400,
      timeoutMs: 180_000,
      attempts: 2,
    },
  );


  let arr: unknown[] = [];
  try {
    arr = parseJsonArray(raw);
  } catch {
    arr = [];
  }

  return segments.map((s, i) => {
    const v = arr[i];
    const text = typeof v === "string" && v.trim().length > 10 ? v.trim() : null;
    return sanitizePrompt(text ?? fallbackPrompt(s));
  });
}

function fallbackPrompt(s: Segment): string {
  return `A single cinematic manga scene depicting: ${s.text}`;
}

/** Removes phrasing that makes the model draw an extra character sheet / portrait. */
export function sanitizePrompt(p: string): string {
  return p
    .replace(
      /\b(character (sheet|reference|design|lineup|turnaround|bible)|reference sheet|model sheet|inset portrait|split panel|multiple panels|panel grid|collage|side-by-side|two panels|comic page layout|storyboard grid)\b/gi,
      "",
    )
    .replace(/\b(black[- ]and[- ]white|black ?& ?white|monochrome|monochromatic|gr[ae]yscale|sepia|screentone|halftone|ink wash only)\b/gi, "full colour")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

export function composeImagePrompt(prompt: string): string {
  return `${STYLE}. ${sanitizePrompt(prompt)}. ${SINGLE_PANEL_GUARD}. 16:9 widescreen cinematic framing.`;
}

/** Calls Flux.1 Schnell (free tier) with automatic retries. Always 16:9. */
export async function generateImage(prompt: string, seed: number): Promise<string> {
  const key = process.env["PIXAZO_API_KEY"];
  if (!key) throw new Error("Missing PIXAZO_API_KEY");

  let lastErr = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(PIXAZO_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "Ocp-Apim-Subscription-Key": key,
        },
        body: JSON.stringify({
          prompt: composeImagePrompt(prompt).slice(0, 1800),
          num_steps: 4,
          seed: seed + attempt,
          width: 1024,
          height: 576,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { output?: string };
        if (json.output) return json.output;
        lastErr = "no output url";
      } else {
        lastErr = `${res.status} ${await res.text().catch(() => "")}`.slice(0, 300);
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`Image generation failed: ${lastErr}`);
}
