// Fails the build if any FAKE sample data or sample-mode code reached the production bundle in dist/.
import { readdirSync, readFileSync } from 'node:fs';

const MARKERS = [
  'FAKE-REF',
  'Images shared in a closed group',
  'Threats to release images',
  'Police unit',
  'Repeated unwanted sexual messages from several',
];
const bad = [];
for (const f of readdirSync('dist/assets').filter((n) => n.endsWith('.js'))) {
  const text = readFileSync(`dist/assets/${f}`, 'utf8');
  for (const m of MARKERS) if (text.includes(m)) bad.push(`${f} contains "${m}"`);
}
if (bad.length) {
  console.error('Sample data found in the production bundle:\n' + bad.join('\n'));
  process.exit(1);
}
console.log('check-no-fake: production bundle contains no sample data.');
