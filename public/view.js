(function () {
  const root = document.getElementById('root');
  const LF = window.LF; // Leaflet, saved in index.html before Panoramax loads

  const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#d81b60', '#6d4c41', '#fdd835', '#546e7a'];
  // Esri's World Street Map: no key needed (OpenStreetMap's and CARTO's tile servers
  // refuse sandboxed pages / need a key). Swap this for any other XYZ tile URL.
  const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
  const CREDIT = 'Street photos: Panoramax contributors · Map tiles: Esri, HERE, Garmin, OpenStreetMap contributors';

  // Anything players typed (their names) is escaped before it goes into the page
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const send = (name, ...args) => parent.postMessage({ type: 'move', name, args }, '*');
  const nm = (names, id) => esc(names[id] || `Player ${Number(id) + 1}`);
  const colorOf = (id) => COLORS[Number(id) % COLORS.length];
  const $ = (id) => document.getElementById(id);

  let last = null; // the most recent message from the platform
  let layoutKey = null; // which screen layout is currently built
  let nudgeAt = 0;
  let map = null; // the Leaflet map of the current layout, if any
  let pin = null; // this phone's own pin (not sent until confirmed)
  let sentAt = 0;
  let joinSentAt = 0; // when this phone last told the game "I'm here"
  let amPlayer = false; // has this screen ever been a player's own screen?
  let leaving = false; // the player tapped Leave
  const deadlines = {}; // timer id -> the local time when it ends

  // ---------------- Clock ----------------
  // The server sends "time left"; we turn it into a local deadline once per timer.
  function track(S) {
    if (S.timer && deadlines[S.timer.id] === undefined) deadlines[S.timer.id] = Date.now() + S.timer.left;
  }
  function remaining() {
    if (!last) return null;
    const t = last.state.G.timer;
    return !t || deadlines[t.id] === undefined ? null : deadlines[t.id] - Date.now();
  }
  const isMine = () => last && last.view === 'player' && last.state.G.role !== 'spectator';

  function tick() {
    if (!last) return;
    const S = last.state.G;
    const r = remaining();
    const force = $('force');
    if (force) force.hidden = !(isMine() && S.phase === 'guessing' && r !== null && r <= 0);
    // No photo yet? The phones keep asking, taking turns (the server decides)
    if (isMine() && S.phase === 'waiting' && Date.now() >= nudgeAt) {
      nudgeAt = Date.now() + 3000 + 700 * Number(last.playerID);
      send('retry');
    }
  }
  setInterval(tick, 500);

  // ---------------- Shared pieces ----------------
  // Builds a screen once. Later updates only change parts inside it, so the street
  // view and the map are never torn down while someone is using them.
  function layout(key, html, onBuild) {
    if (key === layoutKey) return;
    layoutKey = key;
    if (map) { map.remove(); map = null; }
    pin = null;
    root.innerHTML = html;
    if (onBuild) onBuild();
  }

  const viewerHTML = (P, tv) =>
    `<div class="pvwrap${tv ? ' tv' : ''}">
       <pnx-photo-viewer endpoint="${esc(P.endpoint)}" sequence="${esc(P.seq)}" picture="${esc(P.pic)}"
         widgets="false" url-parameters="false">
         <pnx-widget-zoom slot="top-right"></pnx-widget-zoom>
         <pnx-widget-player slot="bottom"></pnx-widget-player>
       </pnx-photo-viewer>
       ${window.customElements && customElements.get('pnx-photo-viewer') ? '' : '<p class="pvfail">The street view could not be loaded. Check the internet connection.</p>'}
     </div>`;

  function newMap(el) {
    try {
      if (!LF || typeof LF.map !== 'function') throw new Error('the Leaflet library did not load');
      const m = LF.map(el, { worldCopyJump: true, minZoom: 1 }).setView([30, 10], 2);
      LF.tileLayer(TILES, { maxZoom: 18, attribution: 'Tiles © Esri' }).addTo(m);
      setTimeout(() => m.invalidateSize(), 60);
      return m;
    } catch (e) {
      console.error('Where Am I? map error:', e);
      el.textContent = 'The map could not start: ' + e.message;
      return null;
    }
  }
  const pinIcon = (color) => LF.divIcon({ className: 'pin', html: `<span style="--c:${color}"></span>`, iconSize: [26, 30], iconAnchor: [13, 30] });
  const targetIcon = () => LF.divIcon({ className: 'target', html: '🎯', iconSize: [30, 30], iconAnchor: [15, 15] });

  const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`);

  function chips(S, names) {
    return S.players
      .map((id) => {
        const done = S.locked[id];
        return `<div class="chip${done ? ' done' : ''}">${done ? '✅' : '🤔'} ${nm(names, id)}</div>`;
      })
      .join('');
  }
  const lockedCount = (S) => S.players.filter((id) => S.locked[id]).length;

  // ---------------- Screens ----------------
  function waitingScreen(S, mine) {
    layout(`wait:${mine}`, `<h1>🌍 Finding a street…</h1><p class="waiting">Looking for a 360° photo.</p><p class="credit">${CREDIT}</p>`);
  }

  // The TV and spectators: the photo, and who has locked in
  function tvGuessScreen(S, names) {
    layout(`tv:guess:${S.round}`, `
      <h1>Where am I?</h1>
      ${viewerHTML(S.photo, true)}
      <div id="chips" class="chips"></div>
      <p id="status" class="progress"></p>
      <p class="credit">${CREDIT}</p>`);
    $('chips').innerHTML = chips(S, names);
    $('status').textContent = `${lockedCount(S)} of ${S.players.length} have placed their pin`;
  }

  // A phone: the photo above, the world map below
  function phoneGuessScreen(S, names, playerID) {
    layout(`p:guess:${S.round}`, `
      <div class="top"><strong>Round ${S.round}</strong><span id="status" class="progress"></span></div>
      ${viewerHTML(S.photo, false)}
      <div id="gmap" class="guessmap"></div>
      <div class="actions">
        <button id="confirm" class="big" disabled>Tap the map to place your pin</button>
        <button id="force" class="secondary" hidden>Show results now</button>
      </div>
      <p class="credit">${CREDIT}</p>`, () => {
      map = newMap($('gmap'));
      if (!map) return;
      map.on('click', (e) => {
        const G = last.state.G;
        if (G.locked[last.playerID]) return; // already locked in
        const ll = e.latlng.wrap();
        if (!pin) pin = LF.marker(ll, { draggable: true, icon: pinIcon(colorOf(last.playerID)) }).addTo(map);
        else pin.setLatLng(ll);
        update();
      });
      $('confirm').addEventListener('click', () => {
        if (!pin) return;
        const ll = pin.getLatLng().wrap();
        sentAt = Date.now();
        $('confirm').disabled = true;
        send('guess', ll.lat, ll.lng);
        // If the server never confirms, let the player try again
        setTimeout(update, 3000);
      });
      $('force').addEventListener('click', () => send('revealNow'));
    });

    function update() {
      const G = last.state.G;
      const locked = !!G.locked[last.playerID];
      const btn = $('confirm');
      if (!btn) return;
      if (locked && !pin && G.myGuess && map) {
        pin = LF.marker([G.myGuess.lat, G.myGuess.lon], { icon: pinIcon(colorOf(last.playerID)) }).addTo(map);
      }
      if (locked && pin) pin.dragging.disable();
      const sending = !locked && Date.now() - sentAt < 3000;
      btn.disabled = locked || !pin || sending;
      btn.textContent = locked ? '✅ Locked in!' : pin ? 'Confirm my guess' : 'Tap the map to place your pin';
      $('status').textContent = `${lockedCount(G)} of ${G.players.length} locked in`;
    }
    update();
  }

  // Everyone's pins and the answer, with the scores
  function revealScreen(S, names, mine) {
    layout(`reveal:${S.round}:${mine}`, `
      <h1>📍 ${esc(S.answer.area)}</h1>
      <div id="rmap" class="revmap${mine ? '' : ' tv'}"></div>
      <ol id="board" class="board"></ol>
      ${mine ? '<button id="next" class="big">Next round</button>' : '<p class="waiting">Tap “Next round” on any phone.</p>'}
      <p class="credit">${S.answer.credit ? `Photo: ${esc(S.answer.credit)} · ` : ''}${CREDIT}</p>`, () => {
      map = newMap($('rmap'));
      if (map) {
        const a = [S.answer.lat, S.answer.lon];
        const pts = [a];
        LF.marker(a, { icon: targetIcon(), zIndexOffset: 1000 }).addTo(map);
        for (const id of S.players) {
          const g = S.guesses[id];
          if (!g) continue;
          const c = colorOf(id);
          pts.push([g.lat, g.lon]);
          LF.polyline([[g.lat, g.lon], a], { color: c, weight: 3, dashArray: '6 6' }).addTo(map);
          LF.marker([g.lat, g.lon], { icon: pinIcon(c) }).addTo(map)
            .bindTooltip(nm(names, id), { permanent: true, direction: 'top', offset: [0, -28], className: 'name' });
        }
        const b = LF.latLngBounds(pts);
        if (pts.length === 1 || b.getNorthEast().equals(b.getSouthWest())) map.setView(a, 14);
        else map.fitBounds(b, { padding: [50, 50], maxZoom: 16 });
      }
      if (mine) $('next').addEventListener('click', () => send('nextRound', last.state.G.round));
    });
    const medals = ['🥇', '🥈', '🥉'];
    const ids = [...S.players].sort((a, b) => ((S.results[b] || {}).pts || -1) - ((S.results[a] || {}).pts || -1));
    $('board').innerHTML = ids
      .map((id, i) => {
        const r = S.results[id];
        const right = r
          ? `<strong>${r.pts.toLocaleString()}</strong> <span class="dist">${fmtDist(r.km)} away</span>`
          : '<span class="dist">no guess</span>';
        return `<li style="--c:${colorOf(id)}"><span>${r ? medals[i] || '' : ''} ${nm(names, id)}</span><span>${right}</span></li>`;
      })
      .join('');
  }

  // ---------------- Render ----------------
  function render(msg) {
    last = msg;
    const { names, playerID, state } = msg;
    const S = state.G;
    track(S);
    const mine = isMine();
    if (mine) amPlayer = true;
    // Tell the game this player is here, so rounds wait for their guess (and only theirs)
    if (mine && !leaving && !S.players.includes(String(playerID)) && Date.now() - joinSentAt > 2000) {
      joinSentAt = Date.now();
      send('join');
    }
    if (S.phase === 'waiting') waitingScreen(S, mine);
    else if (S.phase === 'reveal') revealScreen(S, names, mine);
    else if (mine) phoneGuessScreen(S, names, playerID);
    else tvGuessScreen(S, names);
    tick();
  }

  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data) return;
    if (e.data.type === 'state') render(e.data);
    else if (e.data.type === 'leaving') {
      leaving = true;
      if (amPlayer) {
        // Take this player out of the round first, then let the platform free the seat
        parent.postMessage({ type: 'leave-veto' }, '*');
        send('leave');
        setTimeout(() => parent.postMessage({ type: 'leave' }, '*'), 300);
      } else {
        parent.postMessage({ type: 'leave' }, '*');
      }
    }
  });
  parent.postMessage({ type: 'ready' }, '*');
})();