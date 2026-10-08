(function () {
  const { h, files, toast } = Dash;
  const MAX_SIDE = 1920;

  // Shrink big photos before storing so the browser's storage doesn't fill up.
  async function shrink(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const canvas = h('canvas', { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
  }

  Dash.registerTile({
    type: 'image',
    name: 'Images',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 1, h: 1 },
    create(ctx) {
      const s = ctx.state;
      if (!s.interval) Object.assign(s, { interval: 30, contain: false });

      let images = []; // { key, url }
      let index = 0, lastSwap = Date.now(), dead = false;

      const picker = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true,
        onchange: () => { addFiles(picker.files); picker.value = ''; } });
      const view = h('div', { class: 'grow', style: 'height:100%' });
      ctx.el.append(picker, view,
        h('div', { class: 'tools' },
          h('button', { class: 'btn', onclick: () => picker.click() }, 'Add'),
          h('button', { class: 'btn', onclick: () => show(index + 1) }, 'Next'),
          h('button', { class: 'btn', onclick: () => { s.contain = !s.contain; ctx.save(); show(index); } }, 'Fit'),
          h('button', { class: 'btn', onclick: cycleInterval }, 'Speed'),
          h('button', { class: 'btn', onclick: removeCurrent }, 'Remove')));

      ctx.el.addEventListener('dragover', e => { e.preventDefault(); ctx.el.classList.add('dragover'); });
      ctx.el.addEventListener('dragleave', () => ctx.el.classList.remove('dragover'));
      ctx.el.addEventListener('drop', e => { e.preventDefault(); ctx.el.classList.remove('dragover'); addFiles(e.dataTransfer.files); });

      async function reload() {
        const stored = await files.list(ctx.id);
        if (dead) return;
        images.forEach(i => URL.revokeObjectURL(i.url));
        images = stored.map(f => ({ key: f.key, url: URL.createObjectURL(f.blob) }));
        show(index);
      }
      async function addFiles(list) {
        try {
          for (const file of list) if (file.type.startsWith('image/')) await files.add(ctx.id, await shrink(file));
        } catch (err) { console.error(err); toast('Could not add that image.'); }
        index = images.length; // jump to the first new one
        reload();
      }
      async function removeCurrent() {
        if (!images.length) return;
        await files.remove(images[index].key);
        reload();
      }
      function cycleInterval() {
        const options = [10, 30, 60, 300, 900];
        s.interval = options[(options.indexOf(s.interval) + 1) % options.length];
        ctx.save();
        toast(`New image every ${s.interval < 60 ? s.interval + ' seconds' : s.interval / 60 + ' min'}`);
      }
      function show(i) {
        lastSwap = Date.now();
        if (!images.length) {
          return view.replaceChildren(h('div', { class: 'empty', style: 'height:100%', onclick: () => picker.click() }, 'Drop images here or click to add'));
        }
        index = ((i % images.length) + images.length) % images.length;
        view.replaceChildren(h('img', { src: images[index].url, class: s.contain ? 'contain' : '', draggable: false }));
      }

      reload();
      ctx.every(1000, () => { if (images.length > 1 && Date.now() - lastSwap >= s.interval * 1000) show(index + 1); });

      return {
        destroy() { dead = true; images.forEach(i => URL.revokeObjectURL(i.url)); },
        remove() { files.removeAll(ctx.id); },
      };
    },
  });
})();
