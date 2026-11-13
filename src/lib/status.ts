import type { LedgerRow } from './schemas';

export type Tone = '' | 'wait' | 'done' | 'shut';
export interface StatusVisual {
  segments: 1 | 2 | 3 | 4;
  tone: Tone;
}

/** How many of the four track segments are lit, and the colour. Rows 1 to 4 of the design set the pattern; the rest extend it. */
const VISUALS: Record<LedgerRow['status'], StatusVisual> = {
  submitted: { segments: 1, tone: 'wait' },
  acknowledged: { segments: 2, tone: '' },
  under_investigation: { segments: 3, tone: '' },
  info_requested: { segments: 2, tone: 'wait' },
  resubmission_requested: { segments: 1, tone: 'wait' },
  no_response: { segments: 1, tone: 'wait' },
  closed_resolved: { segments: 4, tone: 'done' },
  closed_unresolved: { segments: 4, tone: 'shut' },
};

export function statusVisual(status: LedgerRow['status']): StatusVisual {
  return VISUALS[status];
}
