import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DemoCopySchema, type DemoCopyOutput } from "@/lib/validation/schemas";
import {
  DEMO_CONTENT_SYSTEM_PROMPT,
  DEMO_CONTENT_PROMPT_VERSION,
  buildDemoContentUserPrompt,
  type DemoContentInput,
} from "@/prompts/demo-generation";
import { AI_MODEL, AI_MAX_TOKENS } from "@/lib/ai/config";
import { AnalysisError, classifyAnthropicError } from "@/lib/ai/errors";
import { buildMockDemoContent } from "./mock-content";

export interface GenerateDemoContentResult {
  data: DemoCopyOutput;
  usedMock: boolean;
  model: string | null;
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}

function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * DEMO_MODE is checked first, before ANTHROPIC_API_KEY presence — unlike
 * lib/google/places.ts, which only falls back to mock data when its API
 * key is absent. Here the key IS typically configured (Step 7 needs it),
 * but the account may lack credits, so DEMO_MODE is the explicit dev-mode
 * override: set it to "false" only once real Claude calls are desired.
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
 * Produces the demo website copy (Step 8's "Generate Personalized Demo
 * Content"). Mock and real paths return the identical DemoCopyOutput
 * shape, validated the same way, so lib/demo/generate-demo.ts's
 * orchestration and validation logic never need to branch on which path
 * ran — only `usedMock` on the result reflects it.
 */
export async function generateDemoContent(
  input: DemoContentInput
): Promise<GenerateDemoContentResult> {
  if (isDemoModeEnabled()) {
    return {
      data: buildMockDemoContent(input),
      usedMock: true,
      model: null,
      promptVersion: DEMO_CONTENT_PROMPT_VERSION,
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
      system: DEMO_CONTENT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildDemoContentUserPrompt(input) }],
      output_config: {
        format: zodOutputFormat(DemoCopySchema),
        effort: "low",
      },
    });
  } catch (err) {
    throw classifyAnthropicError(err);
  }

  if (response.stop_reason === "refusal") {
    throw new AnalysisError(
      "INVALID_RESPONSE",
      "Claude declined to generate demo content.",
      false
    );
  }

  if (!response.parsed_output) {
    throw new AnalysisError(
      "INVALID_RESPONSE",
      "Claude's response did not match the required structure.",
      false
    );
  }

  const validated = DemoCopySchema.safeParse(response.parsed_output);
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
    promptVersion: DEMO_CONTENT_PROMPT_VERSION,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        }
      : null,
  };
}

export type { DemoContentInput };
