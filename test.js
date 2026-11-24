import { game, config, pool, AREAS, parseFeatures, distanceKm, score, MAX_POINTS } from './server.js';

config.autoRefill = false; // no network in tests

let failures = 0;
const check = (label, ok) => {
  console.log(ok ? 'PASS' : 'FAIL', label);
  if (!ok) failures++;
};
const REJECT = 'INVALID_MOVE';

const photo = (i, area = 'Area ' + (i % 3)) => ({
  pic: `pic-${String(i).padStart(8, '0')}`, seq: `seq-${String(i).padStart(8, '0')}`,
  lat: 48.8566, lon: 2.3522, endpoint: 'https://api.panoramax.xyz/api', area,
});
const fill = (n = 10) => { pool.length = 0; for (let i = 0; i < n; i++) pool.push(photo(i)); };

function newGame(n = 3) {
  const ctx = { numPlayers: n, currentPlayer: '0' };
  const G = game.setup({ ctx });
  return {
    G,
    play: (name, id, ...args) => game.moves[name].move({ G, ctx, playerID: id }, ...args),
    view: (id) => game.playerView({ G, ctx, playerID: id }),
  };
}

// ---- Scoring and distance ----
{
  check('same point is 0 km', distanceKm(48, 2, 48, 2) === 0);
  const d = distanceKm(48.8566, 2.3522, 51.5074, -0.1278); // Paris to London
  check('Paris to London is about 344 km', d > 335 && d < 350);
  check('a perfect guess scores the maximum', score(0) === MAX_POINTS && score(0.02) === MAX_POINTS);
  check('scores fall with distance', score(1) > score(100) && score(100) > score(2000) && score(2000) > 0);
  check('the far side of the world scores almost nothing', score(20000) < 5);
}

// ---- Parsing Panoramax results ----
{
  const area = AREAS[0];
  const feat = (id, extra = {}) => ({
    id, collection: 'c0000000-aaaa', geometry: { type: 'Point', coordinates: [2.35, 48.86] },
    properties: {}, links: [{ rel: 'self', href: `https://panoramax.example.org/api/collections/c0000000-aaaa/items/${id}` }], ...extra,
  });
  const out = parseFeatures({ features: [
    feat('a1111111-1'),
    feat('b2222222-2', { properties: { type: 'flat' } }),
    feat('c3333333-3', { properties: { 'pers:interior_orientation': { field_of_view: 70 } } }),
    feat('d4444444-4', { geometry: null }),
    feat('<script>alert(1)</script>'),
    feat('e5555555-5', { links: [{ rel: 'self', href: 'http://evil.example/api/collections/x/items/y' }] }),
  ] }, area);
  check('only real 360° photos with a location are kept', out.length === 2 && out[0].pic === 'a1111111-1');
  check('the photo is shown through its own instance', out[0].endpoint === 'https://panoramax.example.org/api');
  check('an untrusted endpoint falls back to the default', out[1].endpoint === config.api);
  check('bad input does not crash', parseFeatures(null, area).length === 0 && parseFeatures({}, area).length === 0);
  check('every area has a name and a valid box', AREAS.every((a) => a.name && a.bbox[0] < a.bbox[2] && a.bbox[1] < a.bbox[3]));
}

// ---- Setup ----
{
  fill(10);
  const g = newGame(3);
  check('the game starts in round 1, guessing', g.G.round === 1 && g.G.phase === 'guessing');
  check('a photo was taken from the pool', pool.length === 9 && g.G.photo.pic.startsWith('pic-'));
  check('everyone sees the photo', ['0', '1', '2', null].every((id) => g.view(id).photo.pic === g.G.photo.pic));
  const secrets = ['0', '1', '2', null].map((id) => JSON.stringify(g.view(id)));
  check('nobody sees the location or area before the reveal',
    secrets.every((s) => !s.includes('48.8566') && !s.includes('Area ') && !s.includes('secret')));
  check('seated players are players, others spectators', g.view('1').role === 'player' && g.view(null).role === 'spectator');
}

// ---- Guessing ----
{
  fill(10);
  const g = newGame(3);
  check('a spectator cannot guess', g.play('guess', null, 1, 1) === REJECT);
  check('a bad latitude is rejected', g.play('guess', '0', 91, 0) === REJECT);
  check('a bad longitude is rejected', g.play('guess', '0', 0, 181) === REJECT);
  check('non-numbers are rejected', g.play('guess', '0', '5', '5') === REJECT && g.play('guess', '0', NaN, 0) === REJECT);
  g.play('guess', '0', 50.123456789, 3);
  check('a guess is locked in and rounded', g.G.locked['0'] === true && g.G.guesses['0'].lat === 50.12346);
  check('a locked guess cannot be changed', g.play('guess', '0', 10, 10) === REJECT);
  check('only you see your own pin', g.view('0').myGuess.lon === 3 && g.view('1').myGuess === null && g.view(null).myGuess === null);
  check('others only see who has locked in', g.view('1').locked['0'] === true && g.view('1').guesses === null);
  check('no pins are leaked in any view', !JSON.stringify(g.view('1')).includes('50.12') && !JSON.stringify(g.view(null)).includes('50.12'));
  check('the straggler timer starts after the first guess', g.view('1').timer.left > 0 && g.view('1').timer.left <= config.graceMs);
  check('revealing early is rejected', g.play('revealNow', '1') === REJECT);
  g.play('guess', '1', 48.8566, 2.3522);
  check('the round goes on while someone is still guessing', g.G.phase === 'guessing');
  g.play('guess', '2', 0, 0);
  check('it reveals when everyone has guessed', g.G.phase === 'reveal');
}

// ---- Reveal ----
{
  fill(10);
  const g = newGame(3);
  g.play('guess', '0', 48.8566, 2.3522); // spot on
  g.play('guess', '1', 51.5074, -0.1278); // London
  g.play('guess', '2', -33.8688, 151.2093); // Sydney
  const v = g.view(null);
  check('the answer is revealed to everyone', ['0', '1', '2', null].every((id) => g.view(id).answer.area.startsWith('Area ')));
  check('everyone sees everyone\'s pins', Object.keys(v.guesses).length === 3);
  check('a perfect pin scores the maximum', v.results['0'].pts === MAX_POINTS && v.results['0'].km === 0);
  check('closer scores more', v.results['0'].pts > v.results['1'].pts && v.results['1'].pts > v.results['2'].pts);
  check('distances are in kilometres', v.results['1'].km > 335 && v.results['1'].km < 350);
  check('no guesses after the reveal', g.play('guess', '0', 1, 1) === REJECT);
}

// ---- Stragglers ----
{
  fill(10);
  const g = newGame(3);
  check('revealing with no guesses at all is rejected', g.play('revealNow', '0') === REJECT);
  g.play('guess', '0', 1, 1);
  g.G.firstLockAt = Date.now() - config.graceMs - 1;
  check('a spectator cannot force the reveal', g.play('revealNow', null) === REJECT);
  g.play('revealNow', '2');
  check('after the grace period any player can reveal', g.G.phase === 'reveal');
  check('players who never guessed get no result', g.G.results['0'] !== undefined && g.G.results['1'] === undefined);
}

// ---- Next round ----
{
  fill(10);
  const g = newGame(2);
  check('next round is rejected before the reveal', g.play('nextRound', '0', 1) === REJECT);
  g.play('guess', '0', 1, 1);
  g.play('guess', '1', 2, 2);
  check('a spectator cannot start the next round', g.play('nextRound', null, 1) === REJECT);
  check('the wrong round number is rejected', g.play('nextRound', '0', 7) === REJECT);
  const first = g.G.photo.pic;
  g.play('nextRound', '0', 1);
  check('a new round has a new photo and a clean slate',
    g.G.round === 2 && g.G.phase === 'guessing' && g.G.photo.pic !== first &&
    Object.keys(g.G.guesses).length === 0 && g.G.results === null);
  check('a repeated "next round" is ignored', g.play('nextRound', '1', 1) === REJECT);
}

// ---- Variety ----
{
  pool.length = 0;
  for (let i = 0; i < 6; i++) pool.push(photo(i, i < 3 ? 'Paris' : 'Rome'));
  const g = newGame(2);
  const first = g.G.lastArea;
  g.play('guess', '0', 1, 1);
  g.play('guess', '1', 1, 1);
  g.play('nextRound', '0', 1);
  check('the next round is in a different area when possible', g.G.lastArea !== first);
}

// ---- No photos available ----
{
  pool.length = 0;
  const g = newGame(2);
  check('with no photos the game waits', g.G.phase === 'waiting' && g.view('0').photo === null);
  check('a spectator cannot retry', g.play('retry', null) === REJECT);
  g.play('retry', '0');
  check('retrying with nothing ready keeps waiting', g.G.phase === 'waiting');
  pool.push(photo(1));
  g.play('retry', '1');
  check('retrying once a photo is ready starts the round', g.G.phase === 'guessing' && g.G.round === 1);
  check('retry does nothing during a round', g.play('retry', '0') === REJECT);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);