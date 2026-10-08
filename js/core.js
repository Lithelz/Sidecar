// Dashboard core: tile registry, grid layout, edit mode, storage, sound.
// Tiles live in js/tiles/*.js and call Dash.registerTile(). See CLAUDE.md.
window.Dash = (function () {
  const STORE_KEY = 'dash.v1';
  const types = {};
  const live = {}; // tile id -> { el, ctx, inst, timers }
  let data, grid, ghost, saveTimer;
  let editing = false;

  // ---------- helpers ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    el.append(...kids.flat().filter(k => k != null && k !== false));
    return el;
  }
  const pad = n => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  // ms -> "MM:SS" or "H:MM:SS". Rounds up so a countdown shows 00:01 until it's really done.
  function fmt(ms, roundUp = true) {
    const s = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ---------- sound ----------
  const sound = (() => {
    let ac, loopTimer, ringing = 0;
    function audio() {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function beep(freq = 880, dur = 0.18, at = 0) {
      const a = audio(), o = a.createOscillator(), g = a.createGain();
      const t = a.currentTime + at;
      o.frequency.value = freq;
      o.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    }
    const pulse = () => { beep(880, 0.15, 0); beep(880, 0.15, 0.25); beep(880, 0.15, 0.5); };
    return {
      unlock: audio,
      beep,
      chime() { beep(660, 0.25, 0); beep(880, 0.25, 0.25); beep(1100, 0.4, 0.5); },
      startLoop() { if (ringing++ === 0) { pulse(); loopTimer = setInterval(pulse, 1300); } },
      stopLoop() { if (ringing > 0 && --ringing === 0) clearInterval(loopTimer); },
    };
  })();

  // ---------- file storage (IndexedDB, for images etc. too big for localStorage) ----------
  const files = (() => {
    let dbp;
    const db = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('dash-files', 1);
      r.onupgradeneeded = () => r.result
        .createObjectStore('files', { keyPath: 'key', autoIncrement: true })
        .createIndex('tile', 'tile');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const run = async (mode, fn) => {
      const d = await db();
      return new Promise((res, rej) => {
        const tx = d.transaction('files', mode);
        const rq = fn(tx.objectStore('files'));
        tx.oncomplete = () => res(rq && rq.result);
        tx.onerror = () => rej(tx.error);
      });
    };
    return {
      add: (tile, blob) => run('readwrite', s => s.add({ tile, blob })),
      list: tile => run('readonly', s => s.index('tile').getAll(tile)),
      remove: key => run('readwrite', s => s.delete(key)),
      async removeAll(tile) { for (const f of await this.list(tile)) await this.remove(f.key); },
    };
  })();

  // ---------- storage ----------
  function defaultLayout() {
    const portrait = innerHeight > innerWidth;
    const T = (type, x, y, w, h) => ({ id: uid(), type, x, y, w, h, state: {} });
    return portrait
      ? { cols: 6, rows: 12, tiles: [
          T('clock', 0, 0, 6, 2), T('spotify', 0, 2, 6, 2),
          T('pomodoro', 0, 4, 3, 2), T('timer', 3, 4, 3, 2),
          T('stopwatch', 0, 6, 3, 2), T('alarms', 3, 6, 3, 2),
          T('checklist', 0, 8, 3, 4), T('image', 3, 8, 3, 4)] }
      : { cols: 12, rows: 8, tiles: [
          T('clock', 0, 0, 8, 3), T('spotify', 8, 0, 4, 3),
          T('pomodoro', 0, 3, 3, 3), T('timer', 3, 3, 3, 3), T('stopwatch', 6, 3, 3, 3),
          T('checklist', 9, 3, 3, 5),
          T('alarms', 0, 6, 4, 2), T('image', 4, 6, 5, 2)] };
  }
  function load() {
    try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.tiles)) data = defaultLayout();
  }
  function flush() {
    clearTimeout(saveTimer);
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 200);
  }

  // ---------- grid ----------
  function applyGrid() {
    grid.style.setProperty('--cols', data.cols);
    grid.style.setProperty('--rows', data.rows);
  }
  function place(el, t) {
    el.style.gridColumn = `${t.x + 1} / span ${t.w}`;
    el.style.gridRow = `${t.y + 1} / span ${t.h}`;
  }
  function collides(box, ignoreId) {
    return data.tiles.some(t => t.id !== ignoreId &&
      box.x < t.x + t.w && box.x + box.w > t.x &&
      box.y < t.y + t.h && box.y + box.h > t.y);
  }
  function findSpot(w, h) {
    for (let y = 0; y + h <= data.rows; y++)
      for (let x = 0; x + w <= data.cols; x++)
        if (!collides({ x, y, w, h })) return { x, y };
    return null;
  }

  function mountTile(t) {
    const def = types[t.type];
    const body = h('div', { class: 'tile-body' });
    const el = h('section', { class: `tile tile-${t.type}` }, body,
      h('div', { class: 'tile-edit', onpointerdown: e => startDrag(e, t, 'move') },
        h('span', { class: 'tile-name' }, def ? def.name : t.type),
        h('button', { class: 'tile-del', title: 'Remove tile',
          onpointerdown: e => e.stopPropagation(), onclick: () => removeTile(t) }, '×'),
        h('div', { class: 'tile-resize', onpointerdown: e => { e.stopPropagation(); startDrag(e, t, 'resize'); } })));
    place(el, t);
    grid.append(el);

    const entry = live[t.id] = { el, timers: [], rings: 0 };
    t.state = t.state || {};
    const ctx = entry.ctx = {
      id: t.id,
      el: body,
      state: t.state,
      save,
      // Repeating callback that is cleaned up automatically when the tile is removed.
      every(ms, fn) { entry.timers.push(setInterval(fn, ms)); },
      // Flash the tile and loop a sound until the user dismisses it.
      alert(message) {
        const overlay = h('div', { class: 'ring' },
          h('div', { class: 'ring-msg' }, message),
          h('button', { class: 'btn primary', onclick: () => { overlay.remove(); entry.rings--; sound.stopLoop(); } }, 'Dismiss'));
        el.append(overlay);
        entry.rings++;
        sound.startLoop();
      },
    };
    if (!def) { body.append(h('div', { class: 'empty' }, `Unknown tile type "${t.type}"`)); return; }
    try { entry.inst = def.create(ctx) || {}; }
    catch (err) { console.error(err); body.append(h('div', { class: 'empty' }, `${def.name} failed to load`)); }
  }

  function unmountTile(id) {
    const entry = live[id];
    if (!entry) return;
    entry.timers.forEach(clearInterval);
    while (entry.rings-- > 0) sound.stopLoop();
    if (entry.inst && entry.inst.destroy) entry.inst.destroy();
    entry.el.remove();
    delete live[id];
  }

  function addTile(type) {
    const def = types[type];
    const min = def.minSize || { w: 1, h: 1 };
    let size = def.defaultSize || { w: 3, h: 2 };
    size = { w: Math.min(size.w, data.cols), h: Math.min(size.h, data.rows) };
    let spot = findSpot(size.w, size.h);
    if (!spot) { size = min; spot = findSpot(size.w, size.h); }
    if (!spot) return toast('No room. Remove or shrink a tile, or add rows/columns.');
    const t = { id: uid(), type, ...spot, ...size, state: {} };
    data.tiles.push(t);
    mountTile(t);
    save();
  }

  function removeTile(t) {
    const entry = live[t.id];
    if (entry && entry.inst && entry.inst.remove) entry.inst.remove(); // permanent cleanup hook
    unmountTile(t.id);
    data.tiles = data.tiles.filter(x => x.id !== t.id);
    save();
  }

  function startDrag(e, t, mode) {
    if (!editing) return;
    e.preventDefault();
    const rect = grid.getBoundingClientRect();
    const cw = rect.width / data.cols, ch = rect.height / data.rows;
    const min = (types[t.type] && types[t.type].minSize) || { w: 1, h: 1 };
    let next = { x: t.x, y: t.y, w: t.w, h: t.h }, ok = true;
    place(ghost, next);
    ghost.className = 'ghost show';

    const move = ev => {
      const dx = Math.round((ev.clientX - e.clientX) / cw);
      const dy = Math.round((ev.clientY - e.clientY) / ch);
      next = mode === 'move'
        ? { x: clamp(t.x + dx, 0, data.cols - t.w), y: clamp(t.y + dy, 0, data.rows - t.h), w: t.w, h: t.h }
        : { x: t.x, y: t.y, w: clamp(t.w + dx, min.w, data.cols - t.x), h: clamp(t.h + dy, min.h, data.rows - t.y) };
      ok = !collides(next, t.id);
      place(ghost, next);
      ghost.classList.toggle('bad', !ok);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      ghost.className = 'ghost';
      if (ok) { Object.assign(t, next); place(live[t.id].el, t); save(); }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  // ---------- edit mode ----------
  function resizeGrid(key, delta) {
    const used = Math.max(1, ...data.tiles.map(t => key === 'cols' ? t.x + t.w : t.y + t.h));
    const next = clamp(data[key] + delta, used, 24);
    if (next === data[key] && delta < 0) return toast('Move or shrink tiles out of the last ' + (key === 'cols' ? 'column' : 'row') + ' first.');
    data[key] = next;
    applyGrid();
    buildEditBar();
    save();
  }

  function buildEditBar() {
    const bar = document.getElementById('editbar');
    const stepper = (label, key) => h('span', { class: 'stepper' }, label,
      h('button', { class: 'btn', onclick: () => resizeGrid(key, -1) }, '−'),
      h('b', null, String(data[key])),
      h('button', { class: 'btn', onclick: () => resizeGrid(key, 1) }, '+'));
    bar.replaceChildren(
      h('span', { class: 'dim' }, 'Add tile:'),
      ...Object.values(types).map(def => h('button', { class: 'btn', onclick: () => addTile(def.type) }, def.name)),
      h('span', { class: 'spacer' }),
      stepper('Columns', 'cols'), stepper('Rows', 'rows'),
      h('button', { class: 'btn', onclick: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen() }, 'Fullscreen'),
      h('button', { class: 'btn', onclick: resetLayout }, 'Reset layout'),
      h('button', { class: 'btn primary', onclick: () => setEditing(false) }, 'Done'));
  }

  // Back to the default layout for this screen shape. Tile contents are wiped too.
  function resetLayout() {
    if (!confirm('Reset to the default layout? This clears all tiles and their contents.')) return;
    data.tiles.slice().forEach(removeTile);
    data = defaultLayout();
    applyGrid();
    data.tiles.forEach(mountTile);
    buildEditBar();
    flush();
  }

  function setEditing(on) {
    editing = on;
    document.body.classList.toggle('editing', on);
    if (on) buildEditBar();
  }

  // ---------- public ----------
  function registerTile(def) { types[def.type] = def; }

  function start() {
    grid = document.getElementById('grid');
    ghost = h('div', { class: 'ghost' });
    grid.append(ghost);
    load();
    applyGrid();
    data.tiles.forEach(mountTile);
    document.getElementById('editbtn').onclick = () => setEditing(true);
    addEventListener('keydown', e => { if (e.key === 'Escape' && editing) setEditing(false); });
    addEventListener('beforeunload', flush);
    // Browsers block audio until the page has been clicked once.
    addEventListener('pointerdown', sound.unlock, { once: true });
  }

  return { registerTile, start, h, pad, uid, fmt, toast, sound, files };
})();
