/**
 * Centralized AI model configuration. Read from env so it can be tuned
 * without touching call sites; every AI call in the app must import from
 * here rather than hardcoding a model string or token limit.
 */
export const AI_MODEL = process.env.AI_MODEL?.trim() || "claude-opus-5";
export const AI_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS) || 4096;

export const AI_PROVIDER = "anthropic";
