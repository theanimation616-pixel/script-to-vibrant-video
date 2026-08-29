import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseScript } from "./script";
import { buildCharacterBible, writePrompts, generateImage } from "./manga.server";

export const analyzeScript = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ script: z.string().min(5) }).parse(d))
  .handler(async ({ data }) => {
    const segments = parseScript(data.script);
    if (segments.length === 0) {
      throw new Error("No (m:ss) timestamps found in the script.");
    }
    const bible = await buildCharacterBible(data.script);
    return { segments, bible };
  });

export const promptsForBatch = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        bible: z.string(),
        segments: z.array(
          z.object({
            index: z.number(),
            start: z.number(),
            end: z.number(),
            text: z.string(),
          }),
        ),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const prompts = await writePrompts(data.bible, data.segments);
    return { prompts };
  });

export const renderImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ prompt: z.string().min(5), seed: z.number().int() }).parse(d),
  )
  .handler(async ({ data }) => {
    const url = await generateImage(data.prompt, data.seed);
    return { url };
  });
