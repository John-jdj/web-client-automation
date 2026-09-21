import type { WebsiteNeedLevelSchema } from "@/lib/validation/schemas";
import type { z } from "zod";

export const SCORING_VERSION = "v1";

type WebsiteNeedLevel = z.infer<typeof WebsiteNeedLevelSchema>;

export interface LeadScoreInput {
  hasWebsite: boolean;
  rating: number | null;
  reviewCount: number | null;
  phone: string | null;
  email: string | null;
  category: string | null;
  websiteNeedLevel: WebsiteNeedLevel | null;
}

export interface LeadScoreBreakdown {
  score: number;
  websiteScore: number;
  ratingScore: number;
  reviewScore: number;
  phoneScore: number;
  emailScore: number;
  categoryScore: number;
  activityScore: number;
  reasoning: string[];
  scoringVersion: string;
}

/**
 * Categories judged likely to convert into paying web-design clients —
 * i.e. consumer-facing local businesses where a website drives real
 * bookings/orders/foot traffic. Matched case-insensitively as a substring
 * of `category`, since Google Places categories are free text.
 */
const VALUABLE_CATEGORY_KEYWORDS = [
  "restaurant",
  "cafe",
  "coffee",
  "bakery",
  "bar",
  "gym",
  "fitness",
  "salon",
  "spa",
  "beauty",
  "clinic",
  "dentist",
  "doctor",
  "hospital",
  "hotel",
  "boutique",
  "retail",
  "shop",
  "store",
  "photographer",
  "wedding",
  "catering",
];

function isValuableCategory(category: string | null): boolean {
  if (!category) return false;
  const lower = category.toLowerCase();
  return VALUABLE_CATEGORY_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Deterministic lead score — the AI never decides the final number. Only
 * `websiteNeedLevel` (Claude's qualitative assessment) feeds in as an
 * input; every point value below is a fixed rule, so the score is always
 * reproducible and explainable via `reasoning`.
 *
 * The `lead_scores` table has no dedicated "AI website-need" column, so
 * that bonus (+10 HIGH / +5 MEDIUM) is stored under `activity_score` —
 * the one column scoring_version "v1" doesn't otherwise use — rather than
 * silently dropped from the persisted breakdown.
 */
export function calculateLeadScore(input: LeadScoreInput): LeadScoreBreakdown {
  const reasoning: string[] = [];

  let websiteScore = 0;
  if (!input.hasWebsite) {
    websiteScore = 40;
    reasoning.push("No official website");
  }

  let ratingScore = 0;
  if (input.rating != null) {
    if (input.rating >= 4.0) {
      ratingScore += 15;
      reasoning.push(`Rating ${input.rating.toFixed(1)} >= 4.0`);
    }
    if (input.rating >= 4.5) {
      ratingScore += 5;
      reasoning.push(`Rating ${input.rating.toFixed(1)} >= 4.5`);
    }
  }

  let reviewScore = 0;
  if (input.reviewCount != null) {
    if (input.reviewCount >= 50) {
      reviewScore += 10;
      reasoning.push(`${input.reviewCount} reviews >= 50`);
    }
    if (input.reviewCount >= 200) {
      reviewScore += 5;
      reasoning.push(`${input.reviewCount} reviews >= 200`);
    }
  }

  const phoneScore = input.phone ? 10 : 0;
  if (phoneScore) reasoning.push("Phone available");

  const emailScore = input.email ? 10 : 0;
  if (emailScore) reasoning.push("Email available");

  let websiteNeedScore = 0;
  if (input.websiteNeedLevel === "HIGH") {
    websiteNeedScore = 10;
    reasoning.push("High website need from AI");
  } else if (input.websiteNeedLevel === "MEDIUM") {
    websiteNeedScore = 5;
    reasoning.push("Medium website need from AI");
  }

  const categoryScore = isValuableCategory(input.category) ? 5 : 0;
  if (categoryScore) reasoning.push("Active, valuable category");

  const activityScore = websiteNeedScore;

  const rawTotal =
    websiteScore + ratingScore + reviewScore + phoneScore + emailScore + categoryScore + activityScore;
  const score = Math.max(0, Math.min(100, rawTotal));

  return {
    score,
    websiteScore,
    ratingScore,
    reviewScore,
    phoneScore,
    emailScore,
    categoryScore,
    activityScore,
    reasoning,
    scoringVersion: SCORING_VERSION,
  };
}

export type LeadPriority = "LOW" | "MEDIUM" | "HIGH" | "HOT";

export function mapScoreToPriority(score: number): LeadPriority {
  if (score >= 80) return "HOT";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}
