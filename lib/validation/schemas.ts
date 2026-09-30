import { z } from "zod";
import { MAX_DISCOVERY_LIMIT } from "@/lib/google/constants";

export const WebsiteCheckStatusSchema = z.enum(["UNKNOWN", "CHECKED", "ERROR"]);

export const LeadStatusSchema = z.enum([
  "NEW",
  "ANALYZING",
  "QUALIFIED",
  "DISQUALIFIED",
  "DEMO_PENDING",
  "DEMO_CREATED",
  "OUTREACH_READY",
  "QUEUED",
  "CONTACTED",
  "REPLIED",
  "INTERESTED",
  "NOT_INTERESTED",
  "CONVERTED",
  "LOST",
  "DO_NOT_CONTACT",
]);

export const LeadPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "HOT"]);

export const LeadQualificationStatusSchema = z.enum([
  "PENDING",
  "QUALIFIED",
  "DISQUALIFIED",
  "MANUAL_REVIEW",
]);

export const DemoStatusSchema = z.enum([
  "DRAFT",
  "GENERATING",
  "GENERATED",
  "DEPLOYMENT_PENDING",
  "DEPLOYED",
  "FAILED",
  "ARCHIVED",
]);

export const OutreachChannelSchema = z.enum(["email"]);

export const OutreachMessageStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "QUEUED",
  "SENDING",
  "SENT",
  "FAILED",
  "BOUNCED",
  "REPLIED",
  "CANCELLED",
]);

/**
 * Input for creating/updating a business record discovered from a source
 * such as Google Places. `email` is intentionally optional — Google Places
 * frequently doesn't provide one.
 */
export const BusinessInputSchema = z.object({
  google_place_id: z.string().min(1).optional().nullable(),
  business_name: z.string().min(1, "business_name is required"),
  normalized_business_name: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  subcategory: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  website_url: z.url().optional().nullable(),
  has_website: z.boolean().optional(),
  website_checked_at: z.iso.datetime().optional().nullable(),
  website_check_status: WebsiteCheckStatusSchema.optional(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  review_count: z.number().int().min(0).optional().nullable(),
  google_maps_url: z.url().optional().nullable(),
  opening_hours: z.any().optional().nullable(),
  social_links: z.any().optional().nullable(),
  source: z.string().optional(),
  raw_data: z.any().optional().nullable(),
});
export type BusinessInput = z.infer<typeof BusinessInputSchema>;

export const LeadInputSchema = z.object({
  business_id: z.uuid(),
  status: LeadStatusSchema.optional(),
  priority: LeadPrioritySchema.optional(),
  lead_score: z.number().int().min(0).optional(),
  qualification_status: LeadQualificationStatusSchema.optional(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assigned_to: z.uuid().optional().nullable(),
});
export type LeadInput = z.infer<typeof LeadInputSchema>;

export const LeadScoreSchema = z.object({
  lead_id: z.uuid(),
  score: z.number().int().min(0),
  website_score: z.number().int().min(0).optional(),
  rating_score: z.number().int().min(0).optional(),
  review_score: z.number().int().min(0).optional(),
  phone_score: z.number().int().min(0).optional(),
  email_score: z.number().int().min(0).optional(),
  category_score: z.number().int().min(0).optional(),
  activity_score: z.number().int().min(0).optional(),
  reasoning: z.string().optional().nullable(),
  scoring_version: z.string().optional(),
});
export type LeadScoreInput = z.infer<typeof LeadScoreSchema>;

export const DemoInputSchema = z.object({
  lead_id: z.uuid(),
  template_id: z.uuid().optional().nullable(),
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase, hyphen-separated"),
  status: DemoStatusSchema.optional(),
  repository_url: z.url().optional().nullable(),
  deployment_url: z.url().optional().nullable(),
  preview_url: z.url().optional().nullable(),
  generated_content: z.any().optional().nullable(),
  generation_error: z.string().optional().nullable(),
});
export type DemoInput = z.infer<typeof DemoInputSchema>;

export const OutreachMessageSchema = z.object({
  lead_id: z.uuid(),
  campaign_id: z.uuid().optional().nullable(),
  channel: OutreachChannelSchema.optional(),
  recipient_email: z.string().email().optional().nullable(),
  subject: z.string().optional().nullable(),
  message_body: z.string().optional().nullable(),
  status: OutreachMessageStatusSchema.optional(),
  scheduled_at: z.iso.datetime().optional().nullable(),
});
export type OutreachMessageInput = z.infer<typeof OutreachMessageSchema>;

/**
 * Mirrors `automation_settings`. Defaults intentionally keep real outreach
 * disabled (`auto_outreach_enabled: false`, `require_outreach_approval: true`,
 * `demo_mode: true`) — never loosen these defaults without an explicit,
 * deliberate change.
 */
export const AutomationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  discovery_enabled: z.boolean().default(true),
  ai_analysis_enabled: z.boolean().default(true),
  demo_generation_enabled: z.boolean().default(true),
  auto_deployment_enabled: z.boolean().default(true),
  auto_outreach_enabled: z.boolean().default(false),
  followups_enabled: z.boolean().default(true),
  require_outreach_approval: z.boolean().default(true),
  daily_discovery_limit: z.number().int().min(0).default(50),
  daily_ai_limit: z.number().int().min(0).default(50),
  daily_demo_limit: z.number().int().min(0).default(20),
  daily_deployment_limit: z.number().int().min(0).default(20),
  daily_outreach_limit: z.number().int().min(0).default(10),
  hourly_outreach_limit: z.number().int().min(0).default(5),
  followup_1_delay_days: z.number().int().min(0).default(3),
  followup_2_delay_days: z.number().int().min(0).default(7),
  timezone: z.string().default("Asia/Kolkata"),
  demo_mode: z.boolean().default(true),
});
export type AutomationSettingsInput = z.infer<typeof AutomationSettingsSchema>;

/**
 * Input for POST /api/discovery/run. `limit` is capped at
 * MAX_DISCOVERY_LIMIT regardless of what's requested.
 */
export const DiscoveryRequestSchema = z.object({
  location: z.string().trim().min(2, "location must be at least 2 characters").max(200),
  category: z.string().trim().min(2, "category must be at least 2 characters").max(200),
  limit: z
    .number()
    .int()
    .min(1, "limit must be at least 1")
    .max(MAX_DISCOVERY_LIMIT, `limit must not exceed ${MAX_DISCOVERY_LIMIT}`)
    .default(10),
});
export type DiscoveryRequest = z.infer<typeof DiscoveryRequestSchema>;

/**
 * Structured JSON Claude must return for a business analysis (Step 7).
 * Validated on every AI response before anything is persisted — the model
 * never gets to decide the final lead score, only these qualitative inputs.
 */
export const WebsiteNeedLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const LeadAnalysisSchema = z.object({
  businessSummary: z.string(),
  businessType: z.string(),
  targetCustomers: z.array(z.string()),
  likelyServices: z.array(z.string()),
  websiteNeed: z.object({
    level: WebsiteNeedLevelSchema,
    reason: z.string(),
  }),
  recommendedPages: z.array(z.string()),
  recommendedFeatures: z.array(z.string()),
  designStyle: z.string(),
  recommendedColors: z.array(z.string()),
  recommendedCTAs: z.array(z.string()),
  painPoints: z.array(z.string()),
  personalizationPoints: z.array(z.string()),
});
export type LeadAnalysisOutput = z.infer<typeof LeadAnalysisSchema>;

/**
 * Request body for POST /api/leads/analyze.
 */
export const AnalyzeLeadRequestSchema = z.object({
  leadId: z.uuid(),
  regenerate: z.boolean().optional(),
});
export type AnalyzeLeadRequest = z.infer<typeof AnalyzeLeadRequestSchema>;

/**
 * Request body for POST /api/leads/analyze-batch.
 */
export const AnalyzeBatchRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).default(10),
});
export type AnalyzeBatchRequest = z.infer<typeof AnalyzeBatchRequestSchema>;

/**
 * The creative copy Claude (or, in DEMO_MODE, the deterministic mock
 * generator) is responsible for (Step 8). Deliberately narrow: contact
 * details, colors, and the chosen template are never AI-decided — they're
 * filled in by lib/demo/generate-demo.ts from the business record and the
 * template registry, the same "AI supplies inputs, app supplies the
 * authoritative fields" split used for lead scoring.
 */
export const DemoCopySchema = z.object({
  tagline: z.string().min(1),
  heroHeadline: z.string().min(1),
  heroSubheadline: z.string().min(1),
  aboutText: z.string().min(1),
  services: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
      })
    )
    .min(1),
  whyChooseUs: z.array(z.string().min(1)).min(1),
  ctaText: z.string().min(1),
});
export type DemoCopyOutput = z.infer<typeof DemoCopySchema>;

/**
 * Full structured content persisted to `demos.generated_content` — Claude's
 * copy (DemoCopySchema) plus the deterministic fields the app fills in.
 * Validated before every save (Step 8's "Validate Demo" stage).
 */
export const DemoContentSchema = DemoCopySchema.extend({
  templateSlug: z.string().min(1),
  templateName: z.string().min(1),
  designStyle: z.string().min(1),
  contactInfo: z.object({
    phone: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
  }),
});
export type DemoContentOutput = z.infer<typeof DemoContentSchema>;

/**
 * Request body for POST /api/demos/generate.
 */
export const GenerateDemoRequestSchema = z.object({
  leadId: z.uuid(),
  regenerate: z.boolean().optional(),
});
export type GenerateDemoRequest = z.infer<typeof GenerateDemoRequestSchema>;

/**
 * Step 9: deploying a generated demo to Vercel (or, in DEMO_MODE, a
 * deterministic mock deployment — see lib/vercel/deploy-adapter.ts).
 */
export const DemoDeploymentStatusSchema = z.enum([
  "PENDING",
  "BUILDING",
  "READY",
  "FAILED",
  "CANCELLED",
]);
export type DemoDeploymentStatusInput = z.infer<typeof DemoDeploymentStatusSchema>;

export const DeploymentInputSchema = z.object({
  demo_id: z.uuid(),
  provider: z.string().optional(),
  deployment_id: z.string().optional().nullable(),
  repository_url: z.url().optional().nullable(),
  deployment_url: z.url().optional().nullable(),
  status: DemoDeploymentStatusSchema.optional(),
  error_message: z.string().optional().nullable(),
  attempt_count: z.number().int().min(0).optional(),
  started_at: z.iso.datetime().optional().nullable(),
  completed_at: z.iso.datetime().optional().nullable(),
});
export type DeploymentInput = z.infer<typeof DeploymentInputSchema>;

/**
 * Request body for POST /api/demos/deploy-batch.
 */
export const DeployBatchRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).default(10),
});
export type DeployBatchRequest = z.infer<typeof DeployBatchRequestSchema>;

/**
 * Step 10: the creative copy Claude (or, in DEMO_MODE, the deterministic
 * mock generator) is responsible for — see prompts/outreach-generation.ts
 * for the anti-fabrication rules. `personalizationPoints` must trace back
 * to verified lead_analysis/business fields; nothing here is a free-form
 * claim about the business itself.
 */
export const OutreachCopySchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  cta: z.string().min(1),
  personalizationPoints: z.array(z.string().min(1)).min(1),
});
export type OutreachCopyOutput = z.infer<typeof OutreachCopySchema>;

/**
 * Request body for POST /api/outreach/generate.
 */
export const GenerateOutreachRequestSchema = z.object({
  leadId: z.uuid(),
});
export type GenerateOutreachRequest = z.infer<typeof GenerateOutreachRequestSchema>;

/**
 * Request body for POST /api/outreach/prepare-batch.
 */
export const PrepareOutreachBatchRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).default(10),
});
export type PrepareOutreachBatchRequest = z.infer<typeof PrepareOutreachBatchRequestSchema>;

/**
 * Request body/query for POST|GET /api/outreach/unsubscribe (Step 10.1).
 * Deliberately just a signed token — never a caller-supplied email — so
 * an unauthenticated caller can only ever suppress the one recipient the
 * token was actually signed for (see lib/outreach/unsubscribe-token.ts),
 * never an address of their choosing.
 */
export const UnsubscribeRequestSchema = z.object({
  token: z.string().min(1),
});
export type UnsubscribeRequest = z.infer<typeof UnsubscribeRequestSchema>;
