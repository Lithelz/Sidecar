// Weather from open-meteo.com (free, no account or key needed).
(function () {
  const { h, toast } = Dash;

  // WMO weather codes -> [label, icon]
  function describe(code, isDay = true) {
    if (code === 0) return ['Clear', isDay ? '☀️' : '🌙'];
    if (code === 1) return ['Mostly clear', isDay ? '🌤️' : '🌙'];
    if (code === 2) return ['Partly cloudy', '⛅'];
    if (code === 3) return ['Overcast', '☁️'];
    if (code <= 48) return ['Fog', '🌫️'];
    if (code <= 57) return ['Drizzle', '🌦️'];
    if (code <= 67) return ['Rain', '🌧️'];
    if (code <= 77) return ['Snow', '🌨️'];
    if (code <= 82) return ['Showers', '🌧️'];
    if (code <= 86) return ['Snow showers', '🌨️'];
    return ['Thunderstorm', '⛈️'];
  }

  Dash.registerTile({
    type: 'weather',
    name: 'Weather',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 2, h: 2 },
    create(ctx) {
      const s = ctx.state;
      if (!s.unit) s.unit = /-(US|LR|MM)$/.test(navigator.language) ? 'F' : 'C'; // plus s.place: { name, lat, lon }

      let data = null, searching = !s.place;
      const view = h('div', { class: 'center' });
      ctx.el.append(
        h('div', { class: 'tools' },
          h('button', { class: 'btn', onclick: () => { s.unit = s.unit === 'F' ? 'C' : 'F'; ctx.save(); refresh(); } }, '°F/°C'),
          h('button', { class: 'btn', onclick: () => { searching = !searching || !s.place; render(); } }, 'Location')),
        view);

      async function refresh() {
        if (!s.place) return;
        try {
          const res = await fetch('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
            latitude: s.place.lat, longitude: s.place.lon, timezone: 'auto', forecast_days: 6,
            temperature_unit: s.unit === 'F' ? 'fahrenheit' : 'celsius',
            current: 'temperature_2m,apparent_temperature,weather_code,is_day',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min',
          }));
          if (!res.ok) throw new Error('HTTP ' + res.status);
          data = await res.json();
        } catch (err) { console.error(err); if (!data) data = { error: true }; }
        render();
      }

      async function search(query, results) {
        if (!query.trim()) return;
        try {
          const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: query.trim(), count: 5 }));
          const found = (await res.json()).results || [];
          results.replaceChildren(...(found.length ? found.map(p =>
            h('button', { class: 'btn', onclick: () => {
              s.place = { name: p.name, lat: p.latitude, lon: p.longitude };
              searching = false; data = null;
              ctx.save(); render(); refresh();
            } }, [p.name, p.admin1, p.country_code].filter(Boolean).join(', '))) : [h('span', { class: 'dim' }, 'No matches.')]));
        } catch (err) { console.error(err); toast('Could not search for that place.'); }
      }

      function render() {
        if (searching) {
          const results = h('div', { class: 'row wrap' });
          const input = h('input', { type: 'text', class: 'grow', placeholder: 'City name',
            onkeydown: e => { if (e.key === 'Enter') search(input.value, results); } });
          return view.replaceChildren(
            h('div', { class: 'row', style: 'width:100%' }, input, h('button', { class: 'btn primary', onclick: () => search(input.value, results) }, 'Search')),
            results);
        }
        if (!data) return view.replaceChildren(h('div', { class: 'dim' }, 'Loading…'));
        if (data.error) return view.replaceChildren(h('div', { class: 'dim' }, 'Could not load the weather. It will retry.'));

        const now = data.current, daily = data.daily;
        const [label, icon] = describe(now.weather_code, !!now.is_day);
        const deg = n => Math.round(n) + '°';
        view.replaceChildren(
          h('div', { class: 'wx-now' },
            h('span', { class: 'wx-icon' }, icon),
            h('span', { class: 'wx-temp' }, deg(now.temperature_2m)),
            h('div', { class: 'wx-info' },
              h('div', { class: 'wx-place ellipsis' }, s.place.name),
              h('div', null, label),
              h('div', { class: 'dim' }, `Feels ${deg(now.apparent_temperature)} · H ${deg(daily.temperature_2m_max[0])} L ${deg(daily.temperature_2m_min[0])}`))),
          h('div', { class: 'wx-days' }, ...daily.time.slice(1).map((date, i) =>
            h('div', null,
              h('div', { class: 'dim' }, new Date(date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })),
              h('div', { class: 'wx-day-icon' }, describe(daily.weather_code[i + 1])[1]),
              h('div', null, deg(daily.temperature_2m_max[i + 1]), h('span', { class: 'dim' }, ' ' + deg(daily.temperature_2m_min[i + 1])))))));
      }

      render();
      refresh();
      ctx.every(15 * 60000, refresh);
    },
  });
})();
