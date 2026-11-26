// Asks Panoramax which of the game's areas really have true 360° photos.
//
//   node check-areas.mjs            check every area
//   node check-areas.mjs Tokyo      check only areas whose name or region contains "Tokyo"
//   node check-areas.mjs --candidates   check the new places in candidates.mjs instead
//
// Needs internet access. Areas marked "none" can be deleted from AREAS in server.js (the game
// also skips them by itself while running, but removing them saves searches).
import { AREAS, config, parseFeatures } from './server.js';
import { CANDIDATES } from './candidates.mjs';

const useCandidates = process.argv.includes('--candidates');
const filter = (process.argv.slice(2).find((a) => !a.startsWith('--')) || '').toLowerCase();
const areas = (useCandidates ? CANDIDATES : AREAS).filter((a) => `${a.region} ${a.name}`.toLowerCase().includes(filter));
const rows = [];
let shown = false;

async function check(a) {
  const url = `${config.api}/search?bbox=${a.bbox.join(',')}&limit=${config.perSearch}&field_of_view=360`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/geo+json, application/json' } });
    if (!res.ok) return { a, error: `HTTP ${res.status}` };
    const data = await res.json();
    const raw = (data.features || []).length;
    const kept = parseFeatures(data, a).length;
    if (!shown && raw) {
      shown = true;
      const p = data.features[0].properties || {};
      console.log('Example item properties:', JSON.stringify({ type: p.type, 'pers:interior_orientation': p['pers:interior_orientation'] }), '\n');
    }
    return { a, raw, kept };
  } catch (e) {
    return { a, error: e.message };
  }
}

// a few at a time, to be friendly to the public server
const queue = [...areas];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) rows.push(await check(queue.shift()));
}));

rows.sort((x, y) => areas.indexOf(x.a) - areas.indexOf(y.a));
let last = '';
for (const r of rows) {
  if (r.a.region !== last) console.log(`\n== ${(last = r.a.region)} ==`);
  const status = r.error ? `ERROR ${r.error}` : r.kept ? `ok    ${String(r.kept).padStart(3)} true-360 of ${r.raw}` : `none  (${r.raw} photos, 0 true 360°)`;
  console.log(`${status.padEnd(36)} ${r.a.name}`);
}
const good = rows.filter((r) => r.kept);
const none = rows.filter((r) => !r.error && !r.kept);
console.log(`\n${good.length} areas usable, ${none.length} with no 360° photos, ${rows.filter((r) => r.error).length} errors (retry those).`);
if (useCandidates) {
  const keep = good.filter((r) => r.kept >= 5); // a handful of photos is too few to be worth a place
  if (keep.length) {
    console.log('\nPaste into AREAS in server.js:');
    for (const r of keep) console.log(`  area('${r.a.region}', '${r.a.name.replace(/'/g, "\\'")}', ${r.a.bbox.join(', ')}),`);
  }
} else if (none.length) console.log('Remove from AREAS:\n  ' + none.map((r) => r.a.name).join('\n  '));