// Spotify "now playing" tile with play/pause/skip.
// Uses the Authorization Code + PKCE flow, so no client secret is needed, only a client ID
// from a (free) app at https://developer.spotify.com/dashboard. Controls need Spotify Premium.
(function () {
  const { h, toast } = Dash;
  const KEY = 'dash.spotify';
  const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
  const REDIRECT = location.origin + '/';
  const TOKEN_URL = 'https://accounts.spotify.com/api/token';

  let auth = {};
  try { auth = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* start fresh */ }
  const persist = () => localStorage.setItem(KEY, JSON.stringify(auth));
  const changed = () => dispatchEvent(new Event('spotify-auth'));

  const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function login(clientId) {
    auth = { clientId };
    persist();
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    sessionStorage.setItem('dash.spotify.pkce', JSON.stringify({ verifier, state }));
    location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: REDIRECT,
      code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES, state,
    });
  }

  async function tokenRequest(params) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: auth.clientId, ...params }),
    });
    if (!res.ok) throw new Error('Spotify token request failed (' + res.status + ')');
    const t = await res.json();
    auth.access = t.access_token;
    auth.refresh = t.refresh_token || auth.refresh;
    auth.expires = Date.now() + t.expires_in * 1000;
    persist();
  }

  // Finish login if Spotify just redirected back here with ?code=...
  (async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    const pkce = JSON.parse(sessionStorage.getItem('dash.spotify.pkce') || 'null');
    sessionStorage.removeItem('dash.spotify.pkce');
    history.replaceState(null, '', location.pathname);
    if (q.has('error') || !pkce || pkce.state !== q.get('state')) return toast('Spotify login was cancelled or failed.');
    try {
      await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT, code_verifier: pkce.verifier });
      changed();
    } catch (err) { console.error(err); toast('Spotify login failed. Check the client ID and redirect URI.'); }
  })();

  let refreshing;
  async function api(method, path) {
    if (Date.now() > (auth.expires || 0) - 60000) {
      refreshing = refreshing || tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh }).finally(() => { refreshing = null; });
      await refreshing;
    }
    return fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + auth.access } });
  }

  Dash.registerTile({
    type: 'spotify',
    name: 'Spotify',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 2, h: 2 },
    create(ctx) {
      let now = null, fetchedAt = 0; // last /me/player response
      let els = null;

      function build() {
        els = null;
        if (location.protocol === 'file:') {
          return ctx.el.replaceChildren(h('div', { class: 'empty' }, 'Spotify needs the dashboard to be opened with start.command (http://127.0.0.1:8080), not by double-clicking index.html.'));
        }
        if (!auth.refresh) return buildSetup();

        els = {
          bg: h('div', { class: 'sp-bg' }),
          art: h('img', { class: 'sp-art', draggable: false }),
          title: h('div', { class: 'sp-title ellipsis' }),
          artist: h('div', { class: 'sp-artist ellipsis' }),
          bar: h('div'),
          play: h('button', { class: 'btn', onclick: () => control(now && now.is_playing ? 'PUT' : 'PUT', now && now.is_playing ? '/me/player/pause' : '/me/player/play') }, '▶'),
        };
        ctx.el.replaceChildren(els.bg,
          h('div', { class: 'tools' }, h('button', { class: 'btn', onclick: () => { auth = { clientId: auth.clientId }; persist(); changed(); } }, 'Disconnect')),
          h('div', { class: 'sp-wrap' }, els.art,
            h('div', { class: 'sp-info' }, els.title, els.artist,
              h('div', { class: 'sp-bar' }, els.bar),
              h('div', { class: 'sp-ctrl' },
                h('button', { class: 'btn', onclick: () => control('POST', '/me/player/previous') }, '⏮'),
                els.play,
                h('button', { class: 'btn', onclick: () => control('POST', '/me/player/next') }, '⏭')))));
        draw();
        poll();
      }

      function buildSetup() {
        const input = h('input', { type: 'text', class: 'grow', placeholder: 'Client ID', value: auth.clientId || '' });
        ctx.el.replaceChildren(h('div', { class: 'sp-setup scroll' },
          h('b', null, 'Connect Spotify (one-time setup)'),
          h('ol', null,
            h('li', null, 'Go to developer.spotify.com/dashboard and create an app.'),
            h('li', null, 'Set its Redirect URI to ', h('code', null, REDIRECT), ' and tick "Web API".'),
            h('li', null, 'Copy the app\'s Client ID and paste it below.')),
          h('div', { class: 'row' }, input,
            h('button', { class: 'btn primary', onclick: () => { if (input.value.trim()) login(input.value.trim()); } }, 'Connect'))));
      }

      async function poll() {
        if (!els) return;
        try {
          const res = await api('GET', '/me/player');
          if (res.status === 200) now = await res.json();
          else if (res.status === 204) now = null;
          else if (res.status === 401) { auth = { clientId: auth.clientId }; persist(); return changed(); }
          fetchedAt = Date.now();
          draw();
        } catch (err) { console.error(err); }
      }

      async function control(method, path) {
        try {
          const res = await api(method, path);
          if (res.status === 403) toast('Spotify controls need a Premium account.');
          else if (res.status === 404) toast('Open Spotify on a device and play something first.');
        } catch (err) { console.error(err); }
        setTimeout(poll, 500);
      }

      function draw() {
        if (!els) return;
        const item = now && now.item;
        if (!item) {
          els.title.textContent = 'Nothing playing';
          els.artist.textContent = 'Start Spotify on any device';
          els.art.style.visibility = 'hidden';
          els.bg.style.backgroundImage = '';
          els.bar.style.width = '0';
          els.play.textContent = '▶';
          return;
        }
        const images = (item.album && item.album.images) || item.images || [];
        const art = images[0] && images[0].url;
        els.title.textContent = item.name;
        els.artist.textContent = item.artists ? item.artists.map(a => a.name).join(', ') : (item.show && item.show.name) || '';
        els.art.style.visibility = art ? 'visible' : 'hidden';
        if (art && els.art.src !== art) { els.art.src = art; els.bg.style.backgroundImage = `url("${art}")`; }
        els.play.textContent = now.is_playing ? '❚❚' : '▶';
        const progress = now.progress_ms + (now.is_playing ? Date.now() - fetchedAt : 0);
        els.bar.style.width = Math.min(100, (progress / item.duration_ms) * 100) + '%';
        // Track ended since the last poll: fetch the next one right away.
        if (now.is_playing && progress > item.duration_ms + 500 && Date.now() - fetchedAt > 1500) poll();
      }

      addEventListener('spotify-auth', build);
      build();
      ctx.every(5000, poll);
      ctx.every(1000, draw);
      return { destroy() { removeEventListener('spotify-auth', build); } };
    },
  });
})();
