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
