// The single place for site-wide constants and owner-fillable placeholders.
// Replace the bracketed values below with real text. They are injected into pages through i18n variables.
export const site = {
  name: 'SLCCRAOP',
  fullName: 'Sri Lanka Cyber Crime Registry and Accountability Oversight Project',
  timeZone: 'Asia/Colombo',
  pageSize: 20,
  // Tracking codes (manual 5.8): unambiguous alphabet (no I, O, 0, 1), 16 or more characters.
  // Stage 3 must generate codes from this same alphabet.
  trackingCode: { alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', minLength: 16, maxLength: 32 },
  placeholders: {
    contactEmail: '[VERIFY: public contact email address]',
    correctionResponseTime: '[VERIFY: published response time for corrections and removals]',
    ownerPublicName: '[VERIFY: owner public name and role]',
    operatingEntity: '[LEGAL REVIEW REQUIRED: operating entity, or a statement that there is none]',
  },
} as const;
