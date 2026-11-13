import { z } from 'zod';
import { site } from '../config/site';
import { CASE_ID_RE } from './schemas';

export function normaliseTrackingCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

const trackingRe = new RegExp(
  `^[${site.trackingCode.alphabet}]{${site.trackingCode.minLength},${site.trackingCode.maxLength}}$`,
);
export function isTrackingCode(raw: string): boolean {
  return trackingRe.test(normaliseTrackingCode(raw));
}

export const CORRECTION_TYPES = ['correct', 'remove', 'other'] as const;
export const correctionSchema = z.object({
  case_id: z.string().trim().regex(CASE_ID_RE),
  request_type: z.enum(CORRECTION_TYPES),
  details: z.string().trim().min(10).max(1000),
  contact: z.string().trim().max(200).nullable(),
});
