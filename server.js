import crypto from 'node:crypto';

const INVALID_MOVE = 'INVALID_MOVE';

export const config = {
  api: 'https://api.panoramax.xyz/api', // keyless federated Panoramax STAC API
  fetch: (...args) => globalThis.fetch(...args),
  autoRefill: true, // tests switch this off
  poolTarget: 30, // photos kept ready, so a round never waits for the network
  perSearch: 100, // photos requested per area search
  timeoutMs: 10000,
  graceMs: 45000, // after the first guess, stragglers get this long before anyone may reveal
};

export const MAX_POINTS = 5000;
export const SCALE_KM = 1492; // like GeoGuessr's world map: 5000 * e^(-km/1492)

// ---- The pre-defined areas: [west, south, east, north] ----
// Every area here was checked with "node check-areas.mjs" and has true 360° photos. Try new
// places by adding them to candidates.mjs and running "node check-areas.mjs --candidates".
// Areas that turn out to be empty later are skipped while the game runs.
// The game picks a region first and then an area in it, so no single region dominates.
const area = (region, name, west, south, east, north) => ({ region, name, bbox: [west, south, east, north] });
export const AREAS = [
  // Europe
  area('Europe', 'Paris, Le Marais', 2.34, 48.85, 2.375, 48.87),
  area('Europe', 'Paris, Montmartre', 2.33, 48.88, 2.355, 48.892),
  area('Europe', 'Lyon, Presqu’île', 4.825, 45.745, 4.845, 45.77),
  area('Europe', 'Marseille, Vieux-Port', 5.36, 43.288, 5.39, 43.305),
  area('Europe', 'Toulouse, centre', 1.435, 43.595, 1.46, 43.61),
  area('Europe', 'Bordeaux, centre', -0.585, 44.83, -0.56, 44.85),
  area('Europe', 'Nantes, centre', -1.57, 47.205, -1.54, 47.225),
  area('Europe', 'Strasbourg, Grande Île', 7.735, 48.575, 7.765, 48.59),
  area('Europe', 'Montpellier, Écusson', 3.865, 43.605, 3.885, 43.615),
  area('Europe', 'Grenoble, centre', 5.715, 45.18, 5.74, 45.195),
  area('Europe', 'Nice, Vieux-Nice', 7.255, 43.69, 7.285, 43.705),
  area('Europe', 'Brussels, centre', 4.335, 50.838, 4.365, 50.855),
  area('Europe', 'Antwerp, centre', 4.39, 51.215, 4.42, 51.23),
  area('Europe', 'Ghent, centre', 3.71, 51.045, 3.74, 51.06),
  area('Europe', 'Amsterdam, centre', 4.875, 52.36, 4.915, 52.385),
  area('Europe', 'Utrecht, centre', 5.105, 52.085, 5.135, 52.1),
  area('Europe', 'Madrid, Centro', -3.72, 40.41, -3.69, 40.425),
  area('Europe', 'Dublin, centre', -6.28, 53.335, -6.24, 53.355),
  area('Europe', 'Stockholm, Södermalm', 18.05, 59.315, 18.09, 59.335),
  area('Europe', 'Galway, centre', -9.07, 53.265, -9.03, 53.28),
  area('Europe', 'Uppsala, centrum', 17.62, 59.855, 17.65, 59.87),
  area('Europe', 'Dijon, centre', 5.03, 47.315, 5.06, 47.33),
  area('Europe', 'Rouen, centre', 1.085, 49.435, 1.115, 49.45),
  area('Europe', 'Brest, centre', -4.5, 48.38, -4.47, 48.395),
  area('Europe', 'Metz, centre', 6.16, 49.11, 6.19, 49.125),
  area('Europe', 'Tours, centre', 0.675, 47.385, 0.71, 47.4),
  area('Europe', 'Angers, centre', -0.57, 47.465, -0.54, 47.48),
  area('Europe', 'Clermont-Ferrand, centre', 3.07, 45.77, 3.1, 45.785),
  area('Europe', 'Ajaccio, Corsica', 8.725, 41.915, 8.75, 41.93),
  // North America
  area('North America', 'Toronto, Downtown', -79.4, 43.64, -79.36, 43.665),
  area('North America', 'San Francisco, centre', -122.43, 37.77, -122.39, 37.8),
  area('North America', 'Seattle, Downtown', -122.35, 47.595, -122.32, 47.62),
  area('North America', 'Portland, Downtown', -122.69, 45.51, -122.66, 45.53),
  area('North America', 'Tacoma, Downtown', -122.45, 47.245, -122.42, 47.265),
  area('North America', 'Austin, Downtown', -97.76, 30.255, -97.73, 30.275),
  // Latin America & Caribbean
  area('Latin America', 'Buenos Aires, Palermo', -58.44, -34.595, -58.4, -34.575),
  area('Latin America', 'Pointe-à-Pitre, Guadeloupe', -61.55, 16.235, -61.52, 16.255),
  area('Latin America', 'Cayenne, French Guiana', -52.34, 4.93, -52.31, 4.95),
  area('Latin America', 'Córdoba, Centro', -64.2, -31.425, -64.17, -31.405),
  area('Latin America', 'Rosario, Centro', -60.66, -32.955, -60.63, -32.935),
  area('Latin America', 'Mendoza, centro', -68.86, -32.895, -68.83, -32.88),
  area('Latin America', 'La Plata, centro', -57.96, -34.93, -57.93, -34.91),
  // Asia & Middle East
  area('Asia', 'Tokyo, Shibuya', 139.69, 35.65, 139.72, 35.67),
  area('Asia', 'Kyoto, Gion', 135.75, 35.0, 135.78, 35.02),
  area('Asia', 'Taipei, Zhongzheng', 121.5, 25.03, 121.54, 25.05),
  area('Asia', 'Istanbul, Sultanahmet', 28.96, 41.0, 29.0, 41.03),
  area('Asia', 'Bursa, centre', 29.05, 40.18, 29.08, 40.2),
  area('Asia', 'Nara, centre', 135.81, 34.68, 135.84, 34.69),
  area('Asia', 'Kaohsiung, Lingya', 120.285, 22.615, 120.32, 22.635),
  area('Asia', 'Tainan, centre', 120.19, 22.985, 120.22, 23),
  // Africa & Indian Ocean
  area('Africa', 'Saint-Denis, Réunion', 55.44, -20.89, 55.48, -20.86),
  area('Africa', 'Saint-Pierre, Réunion', 55.465, -21.35, 55.495, -21.33),
  area('Africa', 'Mamoudzou, Mayotte', 45.21, -12.795, 45.24, -12.775),
  // Oceania
  area('Oceania', 'Auckland, CBD', 174.755, -36.86, 174.785, -36.84),
  area('Oceania', 'Nouméa, New Caledonia', 166.43, -22.29, 166.47, -22.26),
  area('Oceania', 'Papeete, Tahiti', -149.58, -17.55, -149.55, -17.53),
  area('Oceania', 'Punaauia, Tahiti', -149.62, -17.64, -149.59, -17.61),
  area('Oceania', 'Dumbéa, New Caledonia', 166.43, -22.17, 166.47, -22.14),
];

// ---- Photo pool: filled in the background, drained one photo per round ----
export const pool = [];
const recent = [];
let refilling = false;

const rnd = (n) => crypto.randomInt(n);
const shuffle = (a) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

// Is this STAC item a true 360° photo? We need positive evidence: flat photos, photos with a
// field of view under 360°, photos that are not 2:1 (a full panorama is twice as wide as
// it is tall) and photos that say nothing about being 360° are all rejected.
export function is360(p) {
  if (!p || p.type === 'flat') return false;
  const io = p['pers:interior_orientation'] || {};
  if (Number.isFinite(io.field_of_view) && io.field_of_view < 360) return false;
  const dim = io.sensor_array_dimensions; // [width, height] in pixels
  if (Array.isArray(dim) && dim[0] > 0 && dim[1] > 0 && Math.abs(dim[0] / dim[1] - 2) > 0.05) return false;
  return p.type === 'equirectangular' || io.field_of_view === 360;
}

// Turns a STAC search result into photos we can use (pure, so it is testable)
export function parseFeatures(data, area, api = config.api) {
  const out = [];
  for (const f of (data && data.features) || []) {
    const c = f && f.geometry && f.geometry.coordinates;
    if (!f || !/^[\w-]{8,64}$/.test(String(f.id)) || !/^[\w-]{8,64}$/.test(String(f.collection))) continue;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const p = f.properties || {};
    if (!is360(p)) continue; // only true 360° photos
    // Photos live on one of the federated instances: show them through that instance
    const self = (f.links || []).find((l) => l && l.rel === 'self');
    const href = self && typeof self.href === 'string' ? self.href : '';
    const i = href.indexOf('/collections/');
    const endpoint = i > 0 && /^https:\/\/[\w.-]+(:\d+)?(\/[\w.-]+)*$/.test(href.slice(0, i)) ? href.slice(0, i) : api;
    const credit = String(p['geovisio:producer'] || '').slice(0, 60); // shown after the reveal
    out.push({ pic: String(f.id), seq: String(f.collection), lat: c[1], lon: c[0], endpoint, area: area.name, credit });
  }
  return out;
}

async function searchArea(area) {
  const url = `${config.api}/search?bbox=${area.bbox.join(',')}&limit=${config.perSearch}&field_of_view=360`;
  const res = await config.fetch(url, {
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: { accept: 'application/geo+json, application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeatures(await res.json(), area); // only the true 360° photos
}

// Areas that answered but had no true 360° photos. They are skipped (until the server restarts).
export const dead = new Set();

// A region first, then an area in it, so Europe's many cities don't crowd out the rest.
// Bigger regions get a bigger chance, but only in proportion to the square root of their size.
function pickArea() {
  const live = AREAS.filter((a) => !dead.has(a.name));
  if (!live.length) return null;
  const regions = [...new Set(live.map((a) => a.region))].map((region) => ({
    region,
    areas: live.filter((a) => a.region === region),
  }));
  let roll = (rnd(1e6) / 1e6) * regions.reduce((sum, r) => sum + Math.sqrt(r.areas.length), 0);
  const chosen = regions.find((r) => (roll -= Math.sqrt(r.areas.length)) < 0) || regions[regions.length - 1];
  return chosen.areas[rnd(chosen.areas.length)];
}

export async function refill() {
  if (refilling) return;
  refilling = true;
  let failures = 0;
  try {
    for (let tries = 0; pool.length < config.poolTarget && tries < config.poolTarget * 4 && failures < 3; tries++) {
      const area = pickArea();
      if (!area) break; // every area is known to be empty
      try {
        const all = await searchArea(area);
        if (!all.length) dead.add(area.name);
        const found = all.filter((p) => !recent.includes(p.pic) && !pool.some((q) => q.pic === p.pic));
        // a couple per search, so one street can't flood the pool
        for (const p of shuffle(found).slice(0, 2)) pool.push(p);
        failures = 0;
      } catch (e) {
        failures++;
        console.log(`Where Am I?: search failed for ${area.name}: ${e.message}`);
      }
    }
  } finally {
    refilling = false;
  }
}

function takePhoto(lastArea) {
  if (pool.length < config.poolTarget / 2 && config.autoRefill) refill();
  if (!pool.length) return null;
  const all = pool.map((_, i) => i);
  const other = all.filter((i) => pool[i].area !== lastArea); // avoid the same area twice in a row
  const choices = other.length ? other : all;
  const [photo] = pool.splice(choices[rnd(choices.length)], 1);
  recent.push(photo.pic);
  if (recent.length > 300) recent.shift();
  return photo;
}

export function init() {
  if (config.autoRefill) refill();
}

// ---- Scoring ----
export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}
export const score = (km) => (km <= 0.025 ? MAX_POINTS : Math.round(MAX_POINTS * Math.exp(-km / SCALE_KM)));

// ---- Game state helpers ----
const seated = (G, id) => id != null && G.players.includes(id);

// The game has 20 seats, but only the players who have actually joined take part.
// A phone sends "join" when it opens the game and "leave" when the player walks away.
const activeIds = (G) => G.players.filter((id) => G.active[id]);
const allLocked = (G) => {
  const act = activeIds(G);
  return act.length > 0 && act.every((id) => G.locked[id]);
};

function loadPhoto(G) {
  const p = takePhoto(G.lastArea);
  if (!p) {
    G.phase = 'waiting'; // nothing ready yet: the phones keep asking
    G.photo = null;
    G.secret = null;
    return;
  }
  G.lastArea = p.area;
  G.photo = { pic: p.pic, seq: p.seq, endpoint: p.endpoint };
  G.secret = { lat: p.lat, lon: p.lon, area: p.area, credit: p.credit || '' };
  G.phase = 'guessing';
}

function startRound(G) {
  G.round += 1;
  G.guesses = {};
  G.locked = {};
  G.results = null;
  G.firstLockAt = null;
  loadPhoto(G);
}

function reveal(G) {
  const results = {};
  for (const id of G.players) {
    const g = G.guesses[id];
    if (!g) continue; // never locked in: no score
    const km = distanceKm(g.lat, g.lon, G.secret.lat, G.secret.lon);
    results[id] = { km: Math.round(km * 10) / 10, pts: score(km) };
  }
  G.results = results;
  G.phase = 'reveal';
}

const r5 = (n) => Math.round(n * 1e5) / 1e5;

export const game = {
  name: 'where-am-i',
  minPlayers: 20,
  maxPlayers: 20,

  setup: ({ ctx }) => {
    const G = {
      phase: 'waiting',
      round: 0,
      players: Array.from({ length: ctx.numPlayers }, (_, i) => String(i)), // all seats
      active: {}, // seats whose player has joined and not left
      photo: null,
      secret: null, // never leaves the server until the reveal
      lastArea: null,
      guesses: {},
      locked: {},
      results: null,
      firstLockAt: null,
    };
    startRound(G);
    return G;
  },

  turn: { activePlayers: { all: null } },

  moves: {
    guess: {
      client: false,
      move: ({ G, playerID }, lat, lon) => {
        if (G.phase !== 'guessing' || !seated(G, playerID) || G.locked[playerID]) return INVALID_MOVE;
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return INVALID_MOVE;
        G.active[playerID] = true; // guessing counts as joining
        G.guesses[playerID] = { lat: r5(lat), lon: r5(lon) };
        G.locked[playerID] = true;
        if (G.firstLockAt === null) G.firstLockAt = Date.now();
        if (allLocked(G)) reveal(G); // everyone who is here has guessed
      },
    },
    // A player's phone has opened the game: from now on the round waits for their guess
    join: {
      client: false,
      move: ({ G, playerID }) => {
        if (!seated(G, playerID) || G.active[playerID]) return INVALID_MOVE;
        const roomWasEmpty = activeIds(G).length === 0;
        // the seat may have been used by someone who left: start clean
        delete G.guesses[playerID];
        delete G.locked[playerID];
        G.active[playerID] = true;
        // the first player into an empty room should not be shown an old result
        if (roomWasEmpty && G.phase === 'reveal') startRound(G);
      },
    },
    // A player has left: the round no longer waits for them
    leave: {
      client: false,
      move: ({ G, playerID }) => {
        if (!seated(G, playerID) || !G.active[playerID]) return INVALID_MOVE;
        delete G.active[playerID];
        delete G.guesses[playerID];
        delete G.locked[playerID];
        if (G.results) delete G.results[playerID];
        if (G.phase === 'guessing') {
          if (!G.players.some((id) => G.locked[id])) G.firstLockAt = null; // nobody left has guessed
          if (allLocked(G)) reveal(G); // they were the last one we were waiting for
        }
      },
    },
    // Someone has walked away: after a grace period any player may reveal without them
    revealNow: {
      client: false,
      move: ({ G, playerID }) => {
        if (G.phase !== 'guessing' || !seated(G, playerID) || G.firstLockAt === null) return INVALID_MOVE;
        if (Date.now() < G.firstLockAt + config.graceMs) return INVALID_MOVE;
        reveal(G);
      },
    },
    nextRound: {
      client: false,
      move: ({ G, playerID }, round) => {
        if (G.phase !== 'reveal' || !seated(G, playerID) || round !== G.round) return INVALID_MOVE;
        startRound(G);
      },
    },
    // No photo was ready (network trouble?): try again
    retry: {
      client: false,
      move: ({ G, playerID }) => {
        if (G.phase !== 'waiting' || !seated(G, playerID)) return INVALID_MOVE;
        loadPhoto(G);
      },
    },
  },

  // What each seat may see. The answer and everyone's pins stay hidden until the reveal.
  playerView: ({ G, playerID }) => {
    const isPlayer = seated(G, playerID);
    const revealed = G.phase === 'reveal';
    const waitingForStragglers = G.phase === 'guessing' && G.firstLockAt !== null;
    return {
      phase: G.phase,
      round: G.round,
      players: activeIds(G), // only the players who are here
      role: isPlayer ? 'player' : 'spectator',
      photo: G.photo,
      locked: G.locked,
      myGuess: isPlayer ? G.guesses[playerID] || null : null,
      timer: waitingForStragglers
        ? { id: `grace${G.round}`, left: Math.max(0, G.firstLockAt + config.graceMs - Date.now()) }
        : null,
      answer: revealed ? G.secret : null,
      guesses: revealed ? G.guesses : null,
      results: revealed ? G.results : null,
    };
  },
};