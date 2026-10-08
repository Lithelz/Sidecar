// Shows another website inside a tile. Many sites refuse to be embedded (they show a blank
// or "refused to connect" page); that is the site's choice and can't be worked around here.
(function () {
  const { h } = Dash;

  // Tidy what the user typed, and turn normal YouTube links into their embeddable form.
  function normalize(text) {
    let url = text.trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let m;
    if ((m = /youtube\.com\/watch\?.*?v=([\w-]+)/.exec(url)) || (m = /youtu\.be\/([\w-]+)/.exec(url)) || (m = /youtube\.com\/live\/([\w-]+)/.exec(url))) {
      return `https://www.youtube.com/embed/${m[1]}`;
    }
    if ((m = /youtube\.com\/playlist\?.*?list=([\w-]+)/.exec(url))) return `https://www.youtube.com/embed/videoseries?list=${m[1]}`;
    return url;
  }

  Dash.registerTile({
    type: 'embed',
    name: 'Website',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 2, h: 2 },
    create(ctx) {
      const s = ctx.state; // { url }
      const view = h('div', { class: 'embed-view' });
      ctx.el.append(view,
        h('div', { class: 'tools' },
          h('button', { class: 'btn', onclick: () => render(false) }, 'Reload'),
          h('button', { class: 'btn', onclick: () => render(true) }, 'Change')));

      function render(editing) {
        if (s.url && !editing) {
          return view.replaceChildren(h('iframe', { src: s.url, loading: 'lazy',
            allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture', allowFullscreen: true }));
        }
        const input = h('input', { type: 'text', class: 'grow', placeholder: 'Website or YouTube link', value: s.url || '',
          onkeydown: e => { if (e.key === 'Enter') set(); } });
        const set = () => { const url = normalize(input.value); if (url) { s.url = url; ctx.save(); render(false); } };
        view.replaceChildren(h('div', { class: 'center', style: 'padding:12px; gap:8px' },
          h('div', { class: 'row', style: 'width:100%' }, input, h('button', { class: 'btn primary', onclick: set }, 'Show')),
          h('div', { class: 'dim', style: 'font-size:12px' }, 'Some sites block being shown inside other pages. If the tile stays blank, that site is one of them.')));
      }
      render(false);
    },
  });
})();
