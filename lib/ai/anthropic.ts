import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LeadAnalysisSchema, type LeadAnalysisOutput } from "@/lib/validation/schemas";
import {
  BUSINESS_ANALYSIS_SYSTEM_PROMPT,
  PROMPT_VERSION,
  buildBusinessAnalysisUserPrompt,
  type BusinessAnalysisInput,
} from "@/prompts/business-analysis";
import { AI_MODEL, AI_MAX_TOKENS, AI_PROVIDER } from "./config";
import { AnalysisError, classifyAnthropicError } from "./errors";

export interface AnalyzeBusinessResult {
  data: LeadAnalysisOutput;
  provider: typeof AI_PROVIDER;
  model: string;
  promptVersion: string;
  rawResponse: unknown;
  usage: { inputTokens: number; outputTokens: number } | null;
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
 * Calls Claude once to analyze a business and validates the structured
 * response against LeadAnalysisSchema. Throws AnalysisError on any
 * failure (missing key, API error, or a response that fails validation
 * even via structured outputs) — callers handle retry policy.
 *
 * Kept as a thin, swappable provider boundary: everything downstream
 * (lib/ai/analyze-lead.ts) depends only on AnalyzeBusinessResult, not on
 * the Anthropic SDK, so a different AI provider could replace this file.
 */
export async function analyzeBusiness(
  input: BusinessAnalysisInput
): Promise<AnalyzeBusinessResult> {
  const client = getClient();

  let response;
  try {
    response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: AI_MAX_TOKENS,
      system: BUSINESS_ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildBusinessAnalysisUserPrompt(input) }],
      output_config: {
        format: zodOutputFormat(LeadAnalysisSchema),
        effort: "low",
      },
    });
  } catch (err) {
    throw classifyAnthropicError(err);
  }

  if (response.stop_reason === "refusal") {
    throw new AnalysisError(
      "INVALID_RESPONSE",
      "Claude declined to analyze this business.",
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

  const validated = LeadAnalysisSchema.safeParse(response.parsed_output);
  if (!validated.success) {
    throw new AnalysisError(
      "INVALID_RESPONSE",
      `Claude's response failed validation: ${validated.error.message}`,
      false
    );
  }

  return {
    data: validated.data,
    provider: AI_PROVIDER,
    model: AI_MODEL,
    promptVersion: PROMPT_VERSION,
    rawResponse: response,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        }
      : null,
  };
}

export type { BusinessAnalysisInput };
