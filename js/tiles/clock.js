(function () {
  const { h, pad } = Dash;

  Dash.registerTile({
    type: 'clock',
    name: 'Clock',
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 2, h: 1 },
    create(ctx) {
      const s = ctx.state;
      if (s.h24 === undefined) Object.assign(s, { h24: false, seconds: true });

      const digits = document.createTextNode('');
      const ampm = h('span', { class: 'clock-ampm' });
      const time = h('div', { class: 'big' }, digits, ampm);
      const date = h('div', { class: 'clock-date' });
      const toggle = key => () => { s[key] = !s[key]; ctx.save(); draw(); };

      ctx.el.append(
        h('div', { class: 'tools' },
          h('button', { class: 'btn', onclick: toggle('h24') }, '12/24h'),
          h('button', { class: 'btn', onclick: toggle('seconds') }, 'Seconds')),
        h('div', { class: 'center' }, time, date));

      function draw() {
        const d = new Date();
        const hr = s.h24 ? pad(d.getHours()) : String(d.getHours() % 12 || 12);
        const text = `${hr}:${pad(d.getMinutes())}${s.seconds ? ':' + pad(d.getSeconds()) : ''}`;
        digits.nodeValue = text;
        ampm.textContent = s.h24 ? '' : (d.getHours() < 12 ? 'AM' : 'PM');
        time.style.setProperty('--chars', text.length + (s.h24 ? 0 : 1.5));
        date.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      }
      draw();
      ctx.every(250, draw);
    },
  });
})();
