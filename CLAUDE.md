# Sidecar

Sidecar is a side-monitor dashboard made of tiles. Plain HTML/CSS/JS: no build step, no dependencies, no modules
(classic `<script>` tags so it also works from `file://`).

## Run

Double-click `start.command` (runs `server.rb` with the system Ruby at http://127.0.0.1:8080 and opens it).
Spotify login and the calendar only work from that address. Saved data is per-origin, so `file://` and `127.0.0.1` have separate layouts.

## Structure

- `index.html` – shell; lists one `<script>` per tile.
- `server.rb` – static file server plus `POST /ics`, which fetches iCal feeds for the calendar tile (browsers
  can't, because of CORS). Only hosts in `ALLOWED_HOSTS` are fetched. Restart `start.command` after editing it.
- `js/core.js` – `window.Dash`: tile registry, grid, edit mode (drag/resize/add/remove), storage, sound.
- `js/tiles/<type>.js` – one self-contained file per tile.
- `css/style.css` – theme variables at the top, shared classes, then one section per tile.

## Adding a tile

1. Create `js/tiles/<type>.js`:

```js
(function () {
  const { h } = Dash;
  Dash.registerTile({
    type: 'weather',               // unique id, also gives the tile the CSS class .tile-weather
    name: 'Weather',               // shown in the "Add tile" bar
    defaultSize: { w: 3, h: 2 },   // in grid cells
    minSize: { w: 2, h: 1 },
    create(ctx) {
      // build DOM into ctx.el; keep data in ctx.state and call ctx.save() after changing it
      ctx.el.append(h('div', { class: 'center' }, 'Hello'));
      return { destroy() {}, remove() {} }; // both optional
    },
  });
})();
```

2. Add `<script src="js/tiles/<type>.js"></script>` to `index.html` next to the others.
3. Add styles under a new section in `css/style.css`, scoped to `.tile-<type>`.

It then appears in the edit bar automatically. Nothing in `core.js` needs to change.

## Tile API (`ctx`)

- `ctx.el` – the tile's body element. It is a size container, so use `cqw`/`cqh`/`cqmin` units to scale with the tile.
- `ctx.state` – plain object persisted per tile instance (localStorage key `dash.v1`). Call `ctx.save()` after mutating.
- `ctx.every(ms, fn)` – interval that is cleared automatically when the tile is removed.
- `ctx.alert(message)` – flashes the tile and loops a sound until dismissed.
- `ctx.id` – unique instance id.
- Return `{ destroy() }` to clean up listeners; `{ remove() }` runs only when the user deletes the tile (purge stored data).

## Helpers on `Dash`

`h(tag, props, ...children)` DOM builder (use it rather than innerHTML), `fmt(ms)` → `MM:SS`, `pad`, `uid`,
`toast(msg)`, `sound.chime()` / `sound.beep()`, `files.add/list/remove/removeAll` (IndexedDB blobs keyed by tile id).

## Conventions

- Store timestamps (`endsAt`, `startedAt`), not counters, so timers survive a refresh.
- Shared CSS classes: `.center`, `.row`, `.grow`, `.scroll`, `.empty`, `.label`, `.btn`, `.list-row`,
  `.tools` (hover-only controls), `.big` (digits that fill the tile; set `--chars`).
- Each tile can be added more than once; never use element ids or module-level per-tile state.
