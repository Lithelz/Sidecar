(function () {
  const { h, pad, uid } = Dash;

  function pretty(time) {
    const [hr, min] = time.split(':').map(Number);
    return `${hr % 12 || 12}:${pad(min)} ${hr < 12 ? 'AM' : 'PM'}`;
  }

  Dash.registerTile({
    type: 'alarms',
    name: 'Alarms',
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    create(ctx) {
      const s = ctx.state;
      s.alarms = s.alarms || []; // { id, time "HH:MM", label, on, last (date it last rang) }

      const list = h('div', { class: 'scroll' });
      const time = h('input', { type: 'time' });
      const label = h('input', { type: 'text', class: 'grow', placeholder: 'Label',
        onkeydown: e => { if (e.key === 'Enter') add(); } });
      ctx.el.append(h('div', { class: 'row' }, time, label, h('button', { class: 'btn', onclick: add }, 'Add')), list);

      function add() {
        if (!time.value) return;
        s.alarms.push({ id: uid(), time: time.value, label: label.value.trim(), on: true, last: null });
        s.alarms.sort((a, b) => a.time.localeCompare(b.time));
        label.value = '';
        ctx.save(); render();
      }
      function render() {
        if (!s.alarms.length) return list.replaceChildren(h('div', { class: 'empty' }, 'No alarms. They repeat daily while switched on.'));
        list.replaceChildren(...s.alarms.map(a =>
          h('div', { class: 'list-row' + (a.on ? '' : ' off') },
            h('span', { class: 'time' }, pretty(a.time)),
            h('span', { class: 'grow ellipsis dim' }, a.label),
            h('button', { class: 'btn', onclick: () => { a.on = !a.on; ctx.save(); render(); } }, a.on ? 'On' : 'Off'),
            h('button', { class: 'x', onclick: () => { s.alarms = s.alarms.filter(x => x !== a); ctx.save(); render(); } }, '×'))));
      }
      function tick() {
        const d = new Date();
        const now = `${pad(d.getHours())}:${pad(d.getMinutes())}`, today = d.toDateString();
        for (const a of s.alarms) {
          if (a.on && a.time === now && a.last !== today) {
            a.last = today;
            ctx.save();
            ctx.alert(a.label ? `${a.label} (${pretty(a.time)})` : `Alarm ${pretty(a.time)}`);
          }
        }
      }
      render();
      ctx.every(1000, tick);
    },
  });
})();
