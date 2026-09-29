import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { OutreachCopySchema, type OutreachCopyOutput } from "@/lib/validation/schemas";
import {
  OUTREACH_SYSTEM_PROMPT,
  OUTREACH_PROMPT_VERSION,
  buildOutreachUserPrompt,
  type OutreachContentInput,
} from "@/prompts/outreach-generation";
import { AI_MODEL, AI_MAX_TOKENS } from "@/lib/ai/config";
import { AnalysisError, classifyAnthropicError } from "@/lib/ai/errors";

export interface GenerateOutreachContentResult {
  data: OutreachCopyOutput;
  usedMock: boolean;
  model: string | null;
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * DEMO_MODE checked first, same rationale as
 * lib/demo/generate-demo-content.ts: the Anthropic key is typically
 * configured, but the account may lack credits, so DEMO_MODE is the
 * explicit dev-mode override.
 */
function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE !== "false";
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnalysisError("MISSING_API_KEY", "Claude API key is missing.", false);
  }
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

/**
 * Produces the outreach email copy (Step 10). Mock and real paths return
 * the identical OutreachCopyOutput shape, validated the same way — see
 * lib/demo/generate-demo-content.ts for the identical pattern.
 */
export async function generateOutreachContent(
  input: OutreachContentInput
): Promise<GenerateOutreachContentResult> {
  if (isDemoModeEnabled()) {
    const { buildMockOutreachContent } = await import("./mock-content");
    return {
      data: buildMockOutreachContent(input),
      usedMock: true,
      model: null,
      promptVersion: OUTREACH_PROMPT_VERSION,
      usage: null,
    };
  }

  if (!isAnthropicConfigured()) {
    throw new AnalysisError("MISSING_API_KEY", "Claude API key is missing.", false);
  }

  const client = getClient();

  let response;
  try {
    response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: AI_MAX_TOKENS,
      system: OUTREACH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildOutreachUserPrompt(input) }],
      output_config: {
        format: zodOutputFormat(OutreachCopySchema),
        effort: "low",
      },
    });
  } catch (err) {
    throw classifyAnthropicError(err);
  }

  if (response.stop_reason === "refusal") {
    throw new AnalysisError("INVALID_RESPONSE", "Claude declined to generate outreach content.", false);
  }
  if (!response.parsed_output) {
    throw new AnalysisError(
      "INVALID_RESPONSE",
      "Claude's response did not match the required structure.",
      false
    );
  }

  const validated = OutreachCopySchema.safeParse(response.parsed_output);
  if (!validated.success) {
    throw new AnalysisError(
      "INVALID_RESPONSE",
      `Claude's response failed validation: ${validated.error.message}`,
      false
    );
  }

  return {
    data: validated.data,
    usedMock: false,
    model: AI_MODEL,
    promptVersion: OUTREACH_PROMPT_VERSION,
    usage: response.usage
      ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
      : null,
  };
}

export type { OutreachContentInput };
