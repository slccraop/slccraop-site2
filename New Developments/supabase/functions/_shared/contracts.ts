// Request contracts for every public Edge Function. The website imports these same schemas, so the form and the server
// can never disagree. Pure TypeScript: no Deno or browser APIs. supabase/tests/contracts.test.ts checks them against the site.
import { z } from 'zod';

export const LIMITS = {
  maxBodyBytes: 65536,
  maxFiles: 10,
  maxFileBytes: 10485760,
  description: 5000,
  evidenceSummary: 1000,
  platform: 80,
  reference: 100,
  link: 500,
  username: 100,
  listMax: 10,
  externalLinksMax: 5,
  correctionDetailsMin: 10,
  correctionDetailsMax: 1000,
  correctionContact: 200,
} as const;

export const CATEGORIES = ['ncii', 'sextortion', 'harassment', 'exploitation'] as const;
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const LANGUAGES = ['en', 'si', 'ta'] as const;
export const WITHDRAWAL_REASONS = [
  'fear_of_retaliation',
  'lack_of_authority_response',
  'personal_reasons',
  'other',
] as const;
export const CORRECTION_TYPES = ['correct', 'remove', 'other'] as const;

/** Tracking codes: 20 characters from an alphabet with no I, O, 0 or 1 (about 100 bits). Shown once to the reporter. */
export const TRACKING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TRACKING_LENGTH = 20;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const trackingCode = z.string().min(16).max(48);
const turnstileToken = z.string().min(1).max(2048);
const honeypot = z.string().max(200).default('');
const caseId = z.string().regex(/^SL-\d{4}-\d{4,}$/);

export const fileDeclaration = z.object({
  mime: z.enum(IMAGE_MIMES),
  size: z.number().int().min(1).max(LIMITS.maxFileBytes),
});

export const reportSchema = z
  .object({
    language: z.enum(LANGUAGES),
    contact_language: z.enum(LANGUAGES),
    minor: z.literal(false), // the form never sends true; a server that received true refuses
    reporter_role: z.enum(['self', 'behalf']),
    behalf_consent: z.boolean(),
    category: z.enum(CATEGORIES),
    platform: z.string().trim().min(1).max(LIMITS.platform),
    description: z.string().trim().min(20).max(LIMITS.description),
    links: z.array(z.string().trim().min(1).max(LIMITS.link)).max(LIMITS.listMax),
    usernames: z.array(z.string().trim().min(1).max(LIMITS.username)).max(LIMITS.listMax),
    date_from: dateOnly.nullable(),
    date_to: dateOnly.nullable(),
    reported_to_platform: z.boolean(),
    platform_reference: z.string().trim().max(LIMITS.reference),
    reported_to_police: z.boolean(),
    police_reference: z.string().trim().max(LIMITS.reference),
    evidence_summary: z.string().trim().max(LIMITS.evidenceSummary),
    external_media_links: z.array(z.string().trim().min(1).max(LIMITS.link)).max(LIMITS.externalLinksMax),
    phone: z.string().trim().min(7).max(25),
    contact_consent: z.literal(true), // a call-back is how every report is verified in Phase 1
    files: z.array(fileDeclaration).max(LIMITS.maxFiles),
    turnstile_token: turnstileToken,
    website: honeypot,
  })
  .strict()
  .refine((d) => d.reporter_role === 'self' || d.behalf_consent, {
    path: ['behalf_consent'],
    message: 'required',
  })
  .refine((d) => !d.date_from || !d.date_to || d.date_from <= d.date_to, {
    path: ['date_to'],
    message: 'order',
  });
export type ReportInput = z.infer<typeof reportSchema>;

export const addEvidenceSchema = z
  .object({
    tracking_code: trackingCode,
    files: z.array(fileDeclaration).min(1).max(LIMITS.maxFiles),
    turnstile_token: turnstileToken,
    website: honeypot,
  })
  .strict();

export const finalizeSchema = z
  .object({ tracking_code: trackingCode, upload_id: z.string().uuid() })
  .strict();

export const withdrawSchema = z
  .object({
    tracking_code: trackingCode,
    reason: z.enum(WITHDRAWAL_REASONS).nullable(),
    turnstile_token: turnstileToken,
    website: honeypot,
  })
  .strict();

export const correctionSchema = z
  .object({
    case_id: caseId,
    request_type: z.enum(CORRECTION_TYPES),
    details: z.string().trim().min(LIMITS.correctionDetailsMin).max(LIMITS.correctionDetailsMax),
    contact: z.string().trim().max(LIMITS.correctionContact).nullable(),
    turnstile_token: turnstileToken,
    website: honeypot,
  })
  .strict();

// What the server sends back (the site validates these too).
export const uploadTicketSchema = z.object({
  upload_id: z.string().uuid(),
  path: z.string(),
  token: z.string(),
  mime: z.enum(IMAGE_MIMES),
});
export const submitResponseSchema = z.object({
  ok: z.literal(true),
  tracking_code: z.string(),
  uploads: z.array(uploadTicketSchema),
});
export const evidenceResponseSchema = z.object({ ok: z.literal(true), uploads: z.array(uploadTicketSchema) });
export const okResponseSchema = z.object({ ok: z.literal(true) });
export const errorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.enum(['invalid', 'bot_check', 'closed', 'capped', 'rate_limited', 'rejected', 'server']),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;
