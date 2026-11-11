import { type Api, type AssistantMessage, type Model, type TranscriptMessages, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { type CompactionSettings, compact, generateSummaryWithUsage } from "@earendil-works/pi-coding-agent";
import type { Compaction } from "./experiment.ts";

/**
 * What Pi gives the model to write a compaction's summary (pi-coding-agent 1.5.0, compaction.js): one system prompt, and
 * one of three sets of instructions after the conversation to summarize. `first` is for a context that holds no summary
 * yet, `update` for one whose earlier summary it updates, and `splitTurn` for the start of a turn the compaction cuts
 * through, such as a long activation's (FR-ADAPTER-03).
 */
export interface SummaryInstructions {
  systemPrompt: string;
  first: string;
  update: string;
  splitTurn: string;
}

/** A model's request as Pi makes it: its system prompt and the text of its last message. */
interface Request {
  systemPrompt: string;
  prompt: string;
}

/** The answer a captured request gets: an empty summary. */
const EMPTY_SUMMARY: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "" }],
  api: "none",
  provider: "none",
  model: "none",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: 0,
};

/** The model a captured request names: one that cannot reason, so Pi sends it no thinking level. */
const NO_MODEL = { reasoning: false } as Model<Api>;

/** How Pi calls a model to write a summary. */
type StreamFunction = NonNullable<Parameters<typeof generateSummaryWithUsage>[9]>;

/**
 * The request Pi makes when it writes a summary, taken from the call it makes to the model, which is answered with an
 * empty summary instead: no model is called.
 */
async function captured(write: (stream: StreamFunction) => Promise<unknown>): Promise<Request> {
  let request: Request | undefined;
  const stream = (async (_model: unknown, context: { messages: TranscriptMessages }) => {
    const last = context.messages.at(-1);
    const content = (last !== undefined && "content" in last ? last.content : "") as string | readonly { type: string; text?: string }[];
    const prompt = typeof content === "string" ? content : content.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("");
    request = { systemPrompt: getCurrentSystemPrompt(context.messages), prompt };
    return { result: async () => EMPTY_SUMMARY };
  }) as unknown as StreamFunction;
  await write(stream);
  if (request === undefined) throw new Error("Pi wrote a summary without calling the model");
  return request;
}

/** What a prompt holds after its last marker: the instructions after the conversation they follow. */
function after(prompt: string, marker: string): string {
  const at = prompt.lastIndexOf(marker);
  if (at < 0) throw new Error(`Pi's request for a summary no longer holds ${JSON.stringify(marker)}, so its instructions cannot be told from the conversation`);
  return prompt.slice(at + marker.length);
}

/**
 * Reads Pi's instructions from the requests it makes for each kind of summary, so the record gives the text Pi sends,
 * not a copy that a Pi upgrade could leave behind.
 */
async function readSummaryInstructions(): Promise<SummaryInstructions> {
  const summary = (previous?: string) => (stream: StreamFunction) =>
    generateSummaryWithUsage([], NO_MODEL, undefined, undefined, undefined, undefined, undefined, previous, "off", stream);
  const first = await captured(summary());
  const update = await captured(summary("The earlier summary."));
  // A compaction that cuts through a turn summarizes the turn's start with instructions of its own.
  const splitTurn = await captured((stream) =>
    compact(
      {
        firstKeptEntryId: "kept",
        messagesToSummarize: [],
        turnPrefixMessages: [{ role: "user", content: "", timestamp: 0 }],
        isSplitTurn: true,
        tokensBefore: 0,
        fileOps: { read: new Set(), written: new Set(), edited: new Set() },
        settings: { enabled: true, reserveTokens: 0, keepRecentTokens: 0 },
      },
      NO_MODEL,
      undefined,
      undefined,
      undefined,
      undefined,
      "off",
      stream,
    ),
  );
  return {
    systemPrompt: first.systemPrompt,
    first: after(first.prompt, "</conversation>\n\n"),
    update: after(update.prompt, "</previous-summary>\n\n"),
    splitTurn: after(splitTurn.prompt, "# Instructions\n"),
  };
}

/** Pi's instructions for writing a summary, as Pi 1.5.0 gives them. */
export const summaryInstructions: SummaryInstructions = await readSummaryInstructions();

/** Whether a model's request is Pi's request to write a compaction's summary rather than an agent's turn. */
export function isSummaryRequest(messages: TranscriptMessages): boolean {
  return messages.length > 0 && getCurrentSystemPrompt(messages) === summaryInstructions.systemPrompt;
}

/**
 * Pi's compaction settings for a session whose model has this context window. Pi starts a compaction once the context
 * is above the window minus its reserve, so the reserve is what lies above the share `triggerAt` of the window: models
 * with different windows compact at the same share.
 */
export function piCompactionSettings(compaction: Compaction, contextWindow: number): CompactionSettings {
  if (!compaction.enabled) return { enabled: false };
  return { enabled: true, reserveTokens: contextWindow - Math.floor(contextWindow * compaction.triggerAt), keepRecentTokens: compaction.keepRecentTokens };
}
