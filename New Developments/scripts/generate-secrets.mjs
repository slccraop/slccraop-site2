// Prints ONE ready-to-paste command that sets the three random secrets the Edge Functions need.
// Run it once. Save the printed line in a password manager BEFORE running it: PEPPER and PHONE_KEY cannot be recovered.
import { randomBytes } from 'node:crypto';

const b64 = () => randomBytes(32).toString('base64');
console.error('Copy the line below into your password manager, then paste it into PowerShell and run it.');
console.error(
  'Never commit it. Never change PEPPER or PHONE_KEY later: stored phone numbers could not be read again and tracking codes would stop working.\n',
);
console.log(`npx supabase secrets set PEPPER=${b64()} PHONE_KEY=${b64()} CRON_SECRET=${b64()}`);
