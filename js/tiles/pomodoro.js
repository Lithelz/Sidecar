(function () {
  const { h, fmt, sound } = Dash;
  const PHASES = { work: 'Focus', short: 'Short break', long: 'Long break' };

  Dash.registerTile({
    type: 'pomodoro',
    name: 'Pomodoro',
    defaultSize: { w: 3, h: 3 },
    minSize: { w: 2, h: 2 },
    create(ctx) {
      const s = ctx.state;
      if (!s.phase) Object.assign(s, { work: 25, short: 5, long: 15, phase: 'work', count: 0, endsAt: null, remaining: 25 * 60000 });

      const label = h('div', { class: 'label' });
      const time = h('div', { class: 'big' });
      const dots = h('div', { class: 'pomo-dots' });
      const startBtn = h('button', { class: 'btn primary', onclick: toggle });
      const wrap = h('div', { class: 'center' }, label, time, dots,
        h('div', { class: 'row wrap' }, startBtn,
          h('button', { class: 'btn', onclick: () => next(false) }, 'Skip'),
          h('button', { class: 'btn', onclick: reset }, 'Reset')));

      const setting = (key, text) => h('label', null, text + ' ',
        h('input', { type: 'number', min: 1, max: 180, value: s[key], onchange: e => {
          s[key] = Math.max(1, +e.target.value || 1);
          if (s.phase === key && !s.endsAt) s.remaining = s[key] * 60000;
          ctx.save(); draw();
        } }));
      const settings = h('div', { class: 'pomo-settings', hidden: true },
        setting('work', 'Focus'), setting('short', 'Break'), setting('long', 'Long'));

      ctx.el.append(
        h('div', { class: 'tools' }, h('button', { class: 'btn', onclick: () => { settings.hidden = !settings.hidden; } }, 'Minutes')),
        wrap, settings);

      const left = () => s.endsAt ? s.endsAt - Date.now() : s.remaining;

      function toggle() {
        if (s.endsAt) { s.remaining = left(); s.endsAt = null; }
        else s.endsAt = Date.now() + s.remaining;
        ctx.save(); draw();
      }
      // Move to the next phase. Every 4th focus session is followed by a long break.
      function next(finished) {
        const running = !!s.endsAt;
        if (s.phase === 'work') {
          if (finished) s.count++;
          s.phase = finished && s.count % 4 === 0 ? 'long' : 'short';
        } else s.phase = 'work';
        s.remaining = s[s.phase] * 60000;
        s.endsAt = running ? Date.now() + s.remaining : null;
        ctx.save(); draw();
      }
      function reset() {
        Object.assign(s, { phase: 'work', count: 0, endsAt: null, remaining: s.work * 60000 });
        ctx.save(); draw();
      }
      function draw() {
        if (s.endsAt && left() <= 0) { sound.chime(); next(true); return; }
        const text = fmt(left());
        time.textContent = text;
        time.style.setProperty('--chars', text.length);
        label.textContent = PHASES[s.phase];
        wrap.className = 'center ' + (s.phase === 'work' ? 'pomo-work' : 'pomo-break');
        dots.textContent = '●'.repeat(s.count % 4) + '○'.repeat(4 - (s.count % 4));
        startBtn.textContent = s.endsAt ? 'Pause' : 'Start';
      }
      draw();
      ctx.every(250, draw);
    },
  });
})();
