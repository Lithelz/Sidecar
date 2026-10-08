(function () {
  const { h, fmt, uid } = Dash;

  // "5" -> 5 min, "1:30" -> 1 min 30 s, "1:00:00" -> 1 hour
  function parse(text) {
    const parts = text.trim().split(':').map(Number);
    if (!parts.length || parts.some(n => isNaN(n) || n < 0)) return 0;
    if (parts.length === 1) return parts[0] * 60000;
    return parts.reduce((total, n) => total * 60 + n, 0) * 1000;
  }

  Dash.registerTile({
    type: 'timer',
    name: 'Timer',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    create(ctx) {
      const s = ctx.state;
      s.timers = s.timers || []; // { id, label, duration, endsAt (running) | remaining (paused), done }

      const list = h('div', { class: 'scroll' });
      const input = h('input', { type: 'text', class: 'grow', placeholder: 'min or m:ss',
        onkeydown: e => { if (e.key === 'Enter') add(parse(input.value)); } });

      ctx.el.append(
        h('div', { class: 'row' }, input,
          ...[5, 15, 30].map(m => h('button', { class: 'btn', onclick: () => add(m * 60000) }, String(m)))),
        list);

      function add(ms) {
        if (!ms) return;
        s.timers.push({ id: uid(), label: fmt(ms), duration: ms, endsAt: Date.now() + ms, remaining: ms, done: false });
        input.value = '';
        ctx.save(); render();
      }
      const left = t => t.endsAt ? t.endsAt - Date.now() : t.remaining;

      function toggle(t) {
        if (t.done) { t.done = false; t.remaining = t.duration; t.endsAt = Date.now() + t.duration; }
        else if (t.endsAt) { t.remaining = left(t); t.endsAt = null; }
        else t.endsAt = Date.now() + t.remaining;
        ctx.save(); render();
      }

      function render() {
        list.style.setProperty('--n', Math.max(1, s.timers.length));
        if (!s.timers.length) return list.replaceChildren(h('div', { class: 'empty' }, 'No timers. Type minutes or pick a preset.'));
        list.replaceChildren(...s.timers.map(t =>
          h('div', { class: 'list-row timer-row' + (t.done ? ' done' : '') },
            h('span', { class: 'time grow', 'data-id': t.id }, fmt(left(t))),
            h('span', { class: 'dim' }, t.label),
            h('button', { class: 'btn icon', onclick: () => toggle(t) }, t.done ? '↻' : t.endsAt ? '❚❚' : '▶'),
            h('button', { class: 'x', onclick: () => { s.timers = s.timers.filter(x => x !== t); ctx.save(); render(); } }, '×'))));
      }

      function tick() {
        let changed = false;
        for (const t of s.timers) {
          if (t.endsAt && left(t) <= 0) {
            t.endsAt = null; t.remaining = 0; t.done = true; changed = true;
            ctx.alert(`${t.label} timer finished`);
          }
        }
        if (changed) { ctx.save(); render(); return; }
        for (const t of s.timers) {
          const el = list.querySelector(`[data-id="${t.id}"]`);
          if (el) el.textContent = fmt(left(t));
        }
      }
      render();
      tick();
      ctx.every(250, tick);
    },
  });
})();
