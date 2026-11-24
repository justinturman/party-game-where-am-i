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

// ---- The pre-defined city areas: [west, south, east, north] ----
// Edit freely. Areas with no 360° photos are simply skipped.
export const AREAS = [
  { name: 'Paris, Le Marais', bbox: [2.34, 48.85, 2.375, 48.87] },
  { name: 'Paris, Montmartre', bbox: [2.33, 48.88, 2.355, 48.892] },
  { name: 'Lyon, Presqu’île', bbox: [4.825, 45.745, 4.845, 45.77] },
  { name: 'Marseille, Vieux-Port', bbox: [5.36, 43.288, 5.39, 43.305] },
  { name: 'Toulouse, centre', bbox: [1.435, 43.595, 1.46, 43.61] },
  { name: 'Bordeaux, centre', bbox: [-0.585, 44.83, -0.56, 44.85] },
  { name: 'Nantes, centre', bbox: [-1.57, 47.205, -1.54, 47.225] },
  { name: 'Strasbourg, Grande Île', bbox: [7.735, 48.575, 7.765, 48.59] },
  { name: 'Lille, Vieux-Lille', bbox: [3.05, 50.63, 3.075, 50.645] },
  { name: 'Rennes, centre', bbox: [-1.695, 48.105, -1.665, 48.122] },
  { name: 'Montpellier, Écusson', bbox: [3.865, 43.605, 3.885, 43.615] },
  { name: 'Grenoble, centre', bbox: [5.715, 45.18, 5.74, 45.195] },
  { name: 'Nice, Vieux-Nice', bbox: [7.255, 43.69, 7.285, 43.705] },
  { name: 'Brussels, centre', bbox: [4.335, 50.838, 4.365, 50.855] },
  { name: 'Amsterdam, centre', bbox: [4.875, 52.36, 4.915, 52.385] },
  { name: 'Berlin, Mitte', bbox: [13.375, 52.51, 13.42, 52.53] },
  { name: 'Barcelona, Eixample', bbox: [2.15, 41.385, 2.185, 41.405] },
  { name: 'Madrid, Centro', bbox: [-3.72, 40.41, -3.69, 40.425] },
  { name: 'Rome, centro storico', bbox: [12.47, 41.89, 12.5, 41.905] },
  { name: 'Milan, centro', bbox: [9.175, 45.46, 9.205, 45.475] },
  { name: 'Montréal, Plateau', bbox: [-73.59, 45.515, -73.56, 45.535] },
  { name: 'Québec, Vieux-Québec', bbox: [-71.225, 46.805, -71.195, 46.82] },
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

// Turns a STAC search result into photos we can use (pure, so it is testable)
export function parseFeatures(data, area, api = config.api) {
  const out = [];
  for (const f of (data && data.features) || []) {
    const c = f && f.geometry && f.geometry.coordinates;
    if (!f || !/^[\w-]{8,64}$/.test(String(f.id)) || !/^[\w-]{8,64}$/.test(String(f.collection))) continue;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const p = f.properties || {};
    const fov = p['pers:interior_orientation'] && p['pers:interior_orientation'].field_of_view;
    if (p.type === 'flat' || (Number.isFinite(fov) && fov < 360)) continue; // only true 360° photos
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
  return parseFeatures(await res.json(), area);
}

export async function refill() {
  if (refilling) return;
  refilling = true;
  let failures = 0;
  try {
    for (let tries = 0; pool.length < config.poolTarget && tries < config.poolTarget * 2 && failures < 3; tries++) {
      const area = AREAS[rnd(AREAS.length)];
      try {
        const found = (await searchArea(area)).filter(
          (p) => !recent.includes(p.pic) && !pool.some((q) => q.pic === p.pic),
        );
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
      players: Array.from({ length: ctx.numPlayers }, (_, i) => String(i)),
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
        G.guesses[playerID] = { lat: r5(lat), lon: r5(lon) };
        G.locked[playerID] = true;
        if (G.firstLockAt === null) G.firstLockAt = Date.now();
        if (G.players.every((id) => G.locked[id])) reveal(G);
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
      players: G.players,
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