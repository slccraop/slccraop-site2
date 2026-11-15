import { isFakeData, env } from '../config/env';
import {
  IMAGE_MIMES,
  LIMITS,
  okResponseSchema,
  type UploadTicket,
} from '../../supabase/functions/_shared/contracts.ts';
import { ApiError, callFunctionJson } from './api';

/** Quick checks in the browser. The server re-checks everything by looking at the file's real contents. */
export function fileProblem(file: File): 'type' | 'size' | null {
  if (!(IMAGE_MIMES as readonly string[]).includes(file.type)) return 'type';
  if (file.size < 1 || file.size > LIMITS.maxFileBytes) return 'size';
  return null;
}

/** Sends one file to its one-time signed upload address, then asks the server to check and file it. */
export async function uploadAndFinalize(
  trackingCode: string,
  ticket: UploadTicket,
  file: File,
): Promise<void> {
  if (isFakeData) {
    await new Promise((r) => setTimeout(r, 400)); // sample preview: nothing is uploaded
  } else {
    const { createClient } = await import('@supabase/supabase-js'); // loaded only when someone actually uploads
    const client = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.storage
      .from('evidence-incoming')
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: ticket.mime });
    if (error) throw new ApiError('rejected');
  }
  await callFunctionJson(
    'finalize-evidence',
    { tracking_code: trackingCode, upload_id: ticket.upload_id },
    okResponseSchema,
  );
}
