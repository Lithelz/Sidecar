(function () {
  const { h, uid } = Dash;

  Dash.registerTile({
    type: 'checklist',
    name: 'Checklist',
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 2 },
    create(ctx) {
      const s = ctx.state;
      if (!s.items) Object.assign(s, { title: 'To do', items: [] }); // items: { id, text, done }

      const list = h('div', { class: 'scroll' });
      const input = h('input', { type: 'text', class: 'grow', placeholder: 'Add an item…',
        onkeydown: e => { if (e.key === 'Enter') add(); } });
      const title = h('input', { type: 'text', class: 'check-title grow', value: s.title,
        oninput: () => { s.title = title.value; ctx.save(); } });

      ctx.el.append(
        h('div', { class: 'row' }, title,
          h('button', { class: 'btn', onclick: () => { s.items = s.items.filter(i => !i.done); ctx.save(); render(); } }, 'Clear done')),
        list,
        h('div', { class: 'row' }, input, h('button', { class: 'btn', onclick: add }, 'Add')));

      function add() {
        const text = input.value.trim();
        if (!text) return;
        s.items.push({ id: uid(), text, done: false });
        input.value = '';
        ctx.save(); render();
        list.scrollTop = list.scrollHeight;
      }
      function render() {
        if (!s.items.length) return list.replaceChildren(h('div', { class: 'empty' }, 'Nothing here yet.'));
        list.replaceChildren(...s.items.map(item =>
          h('div', { class: 'list-row check-item' + (item.done ? ' done' : ''),
            onclick: () => { item.done = !item.done; ctx.save(); render(); } },
            h('span', { class: 'check-box' }, item.done ? '✓' : ''),
            h('span', { class: 'grow' }, item.text),
            h('button', { class: 'x', onclick: e => { e.stopPropagation(); s.items = s.items.filter(x => x !== item); ctx.save(); render(); } }, '×'))));
      }
      render();
    },
  });
})();
