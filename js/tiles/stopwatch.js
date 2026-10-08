(function () {
  const { h, pad } = Dash;

  function fmt(ms) {
    const cs = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000);
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
    return `${hh ? hh + ':' : ''}${pad(mm)}:${pad(s % 60)}.${pad(cs)}`;
  }

  Dash.registerTile({
    type: 'stopwatch',
    name: 'Stopwatch',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    create(ctx) {
      const s = ctx.state;
      if (s.elapsed === undefined) Object.assign(s, { startedAt: null, elapsed: 0, laps: [] });

      const time = h('div', { class: 'big' });
      const laps = h('div', { class: 'laps scroll' });
      const startBtn = h('button', { class: 'btn primary', onclick: toggle });
      ctx.el.append(h('div', { class: 'center' }, time,
        h('div', { class: 'row wrap' }, startBtn,
          h('button', { class: 'btn', onclick: lap }, 'Lap'),
          h('button', { class: 'btn', onclick: reset }, 'Reset')),
        laps));

      const total = () => s.elapsed + (s.startedAt ? Date.now() - s.startedAt : 0);

      function toggle() {
        if (s.startedAt) { s.elapsed = total(); s.startedAt = null; }
        else s.startedAt = Date.now();
        ctx.save(); draw();
      }
      function lap() {
        if (!total()) return;
        s.laps.unshift(total());
        ctx.save(); drawLaps();
      }
      function reset() {
        Object.assign(s, { startedAt: null, elapsed: 0, laps: [] });
        ctx.save(); draw(); drawLaps();
      }
      function drawLaps() {
        laps.replaceChildren(...s.laps.map((t, i) => {
          const prev = s.laps[i + 1] || 0;
          return h('div', null, h('span', null, `Lap ${s.laps.length - i}`), h('span', null, `+${fmt(t - prev)}`), h('span', null, fmt(t)));
        }));
      }
      function draw() {
        const text = fmt(total());
        time.textContent = text;
        time.style.setProperty('--chars', text.length);
        startBtn.textContent = s.startedAt ? 'Stop' : 'Start';
      }
      draw(); drawLaps();
      ctx.every(50, () => { if (s.startedAt) draw(); });
    },
  });
})();
