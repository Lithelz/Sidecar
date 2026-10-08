// Agenda tile fed by calendar "secret iCal address" feeds (Google Calendar and compatible).
// Read-only. Feeds are fetched through server.rb (POST /ics) because browsers can't read them directly.
(function () {
  const { h, toast } = Dash;
  const DAY = 86400000;
  const COLORS = ['#6ea8fe', '#5fd08a', '#f7b955', '#e38cf0', '#ff8a7a'];
  const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  // ---------- time zones ----------
  // Times are kept as "wall" values: a UTC timestamp whose UTC fields are the local clock reading
  // in `zone` ('UTC', an IANA name, or null for this computer's zone). That makes repeating
  // events easy to step day by day without daylight-saving drift.
  const formatters = {};
  function zoneOffset(zone, utcMs) {
    const f = formatters[zone] || (formatters[zone] = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    const p = {};
    f.formatToParts(new Date(utcMs)).forEach(x => { p[x.type] = +x.value; });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - utcMs;
  }
  function toInstant(wall, zone) {
    if (zone === 'UTC') return wall;
    if (zone) {
      try { return wall - zoneOffset(zone, wall - zoneOffset(zone, wall)); }
      catch (e) { /* unknown zone name: fall through to local time */ }
    }
    const d = new Date(wall);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
  }

  // ---------- iCal parsing ----------
  function parseDate(value, tzid) {
    const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?/.exec(value.trim());
    if (!m) return null;
    const allDay = !m[4];
    return {
      wall: Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)),
      zone: allDay ? null : m[7] ? 'UTC' : tzid || null,
      allDay,
    };
  }
  const instantOf = d => toInstant(d.wall, d.zone);
  const unescape = s => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');

  function parseICS(text) {
    const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const cal = { name: '', events: [] };
    let ev = null, nested = 0;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; continue; }
      if (line === 'END:VEVENT') { if (ev && ev.start) cal.events.push(ev); ev = null; continue; }
      if (!ev) { if (line.startsWith('X-WR-CALNAME:')) cal.name = unescape(line.slice(13)); continue; }
      // Skip blocks inside an event (reminders), which reuse property names like DESCRIPTION.
      if (line.startsWith('BEGIN:')) { nested++; continue; }
      if (line.startsWith('END:')) { nested--; continue; }
      if (nested) continue;
      const m = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
      if (!m) continue;
      const [, name, params, value] = m;
      const tzid = (/TZID=([^;:]+)/.exec(params) || [])[1];
      if (name === 'DTSTART') ev.start = parseDate(value, tzid);
      else if (name === 'DTEND') ev.end = parseDate(value, tzid);
      else if (name === 'RRULE') ev.rrule = value;
      else if (name === 'EXDATE') value.split(',').forEach(v => { const d = parseDate(v, tzid); if (d) ev.exdates.push(instantOf(d)); });
      else if (name === 'RECURRENCE-ID') ev.recurId = parseDate(value, tzid);
      else if (name === 'UID') ev.uid = value;
      else if (name === 'SUMMARY') ev.summary = unescape(value);
      else if (name === 'LOCATION') ev.location = unescape(value);
      else if (name === 'STATUS') ev.cancelled = value === 'CANCELLED';
    }
    return cal;
  }

  // All dates (as day-start wall values) in a month matching a BYDAY code like "TU", "2TU" or "-1FR".
  function monthWeekdays(year, month, code) {
    const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(code);
    if (!m) return [];
    const weekday = WEEKDAYS.indexOf(m[2]), days = [];
    for (let d = Date.UTC(year, month, 1); new Date(d).getUTCMonth() === ((month % 12) + 12) % 12; d += DAY) {
      if (new Date(d).getUTCDay() === weekday) days.push(d);
    }
    if (!m[1]) return days;
    const pick = +m[1] > 0 ? days[+m[1] - 1] : days[days.length + +m[1]];
    return pick == null ? [] : [pick];
  }

  // Occurrences of one event that overlap [from, to]. Supports the common repeat rules:
  // daily / weekly / monthly / yearly with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY and EXDATE.
  function occurrences(ev, from, to, overridden) {
    const zone = ev.start.zone;
    const dur = ev.end ? ev.end.wall - ev.start.wall : (ev.start.allDay ? DAY : 0);
    if (!ev.rrule) {
      const start = instantOf(ev.start), end = ev.end ? instantOf(ev.end) : start + dur;
      return start <= to && end >= from ? [{ start, end }] : [];
    }
    const rule = {};
    ev.rrule.split(';').forEach(part => { const [k, v] = part.split('='); rule[k] = v; });
    const interval = +rule.INTERVAL || 1, count = +rule.COUNT || Infinity;
    let until = Infinity;
    if (rule.UNTIL) { const u = parseDate(rule.UNTIL); until = instantOf(u) + (u.allDay ? DAY - 1 : 0); }

    const s = new Date(ev.start.wall);
    const timeOfDay = ev.start.wall - Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
    const byday = rule.BYDAY ? rule.BYDAY.split(',') : null;
    const out = [];
    let n = 0;
    // Returns false once the rule is finished or we're past the window.
    const emit = wall => {
      if (wall < ev.start.wall) return true;
      if (n >= count) return false;
      if (wall + dur < from - 2 * DAY) { n++; return true; } // long before the window: just count it
      const start = toInstant(wall, zone);
      if (start > until || start > to) return false;
      n++;
      const end = toInstant(wall + dur, zone);
      if (end >= from && !ev.exdates.includes(start) && !overridden.has(ev.uid + '|' + start)) out.push({ start, end });
      return true;
    };

    for (let i = 0, go = true; go && i < 20000; i++) {
      const step = i * interval;
      let walls;
      if (rule.FREQ === 'DAILY') walls = [ev.start.wall + step * DAY];
      else if (rule.FREQ === 'WEEKLY') {
        const monday = ev.start.wall - ((s.getUTCDay() + 6) % 7) * DAY + step * 7 * DAY;
        const days = byday ? byday.map(code => WEEKDAYS.indexOf(code.slice(-2))) : [s.getUTCDay()];
        walls = days.map(d => monday + ((d + 6) % 7) * DAY);
      } else if (rule.FREQ === 'MONTHLY') {
        const year = s.getUTCFullYear(), month = s.getUTCMonth() + step;
        if (byday) walls = [].concat(...byday.map(code => monthWeekdays(year, month, code)));
        else {
          const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
          const wanted = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : [s.getUTCDate()];
          walls = wanted.map(d => (d < 0 ? length + d + 1 : d)).filter(d => d >= 1 && d <= length).map(d => Date.UTC(year, month, d));
        }
        walls = walls.map(w => w + timeOfDay);
      } else if (rule.FREQ === 'YEARLY') {
        const w = Date.UTC(s.getUTCFullYear() + step, s.getUTCMonth(), s.getUTCDate());
        walls = new Date(w).getUTCMonth() === s.getUTCMonth() ? [w + timeOfDay] : []; // skips Feb 29 in non-leap years
      } else break;
      for (const w of walls.sort((a, b) => a - b)) if (!(go = emit(w))) break;
    }
    return out;
  }

  function upcoming(cal, from, to) {
    const overridden = new Set();
    for (const ev of cal.events) if (ev.recurId) overridden.add(ev.uid + '|' + instantOf(ev.recurId));
    const out = [];
    for (const ev of cal.events) {
      if (ev.cancelled) continue;
      for (const o of occurrences(ev, from, to, overridden)) {
        out.push({ ...o, allDay: ev.start.allDay, summary: ev.summary || '(No title)', location: ev.location });
      }
    }
    return out;
  }

  // ---------- tile ----------
  const dayStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const timeText = ms => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  function dayLabel(day, today) {
    const diff = Math.round((day - today) / DAY);
    const date = new Date(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : date;
  }

  Dash.registerTile({
    type: 'calendar',
    name: 'Calendar',
    defaultSize: { w: 3, h: 4 },
    minSize: { w: 2, h: 2 },
    create(ctx) {
      const s = ctx.state;
      if (!s.feeds) Object.assign(s, { feeds: [], days: 14 }); // feeds: { url, name }

      let events = [], loaded = false, showSetup = !s.feeds.length;
      const view = h('div', { class: 'scroll' });
      ctx.el.append(
        h('div', { class: 'tools' },
          h('button', { class: 'btn', onclick: () => { showSetup = !showSetup; render(); } }, 'Calendars'),
          h('button', { class: 'btn', onclick: refresh }, 'Refresh')),
        view);

      async function refresh() {
        if (location.protocol === 'file:') return;
        const from = Date.now(), to = dayStart(from) + s.days * DAY;
        const all = [];
        await Promise.all(s.feeds.map(async (feed, i) => {
          try {
            const res = await fetch('/ics', { method: 'POST', body: feed.url });
            const text = await res.text();
            if (!res.ok || !text.includes('BEGIN:VCALENDAR')) throw new Error(res.ok ? 'Not a calendar feed' : text || 'HTTP ' + res.status);
            const cal = parseICS(text);
            feed.name = cal.name || feed.name;
            feed.error = null;
            upcoming(cal, from, to).forEach(e => all.push({ ...e, color: COLORS[i % COLORS.length] }));
          } catch (err) { console.error(err); feed.error = err.message; }
        }));
        events = all.sort((a, b) => a.start - b.start);
        loaded = true;
        ctx.save();
        render();
      }

      function addFeed(input) {
        const url = input.value.trim();
        if (!url) return;
        if (!/^(https|webcal):\/\/calendar\.google\.com\/.+\.ics$/.test(url)) return toast('That doesn\'t look like a Google Calendar iCal address (it ends in .ics).');
        s.feeds.push({ url, name: 'Calendar ' + (s.feeds.length + 1) });
        showSetup = false;
        ctx.save(); render(); refresh();
      }

      function renderSetup() {
        const input = h('input', { type: 'text', class: 'grow', placeholder: 'Secret address in iCal format',
          onkeydown: e => { if (e.key === 'Enter') addFeed(input); } });
        view.replaceChildren(h('div', { class: 'setup' },
          h('b', null, 'Add a Google Calendar'),
          h('ol', null,
            h('li', null, 'In Google Calendar, open Settings and click your calendar\'s name in the left sidebar.'),
            h('li', null, 'Scroll to "Integrate calendar" and copy the "Secret address in iCal format".'),
            h('li', null, 'Paste it below. Keep that address private: anyone who has it can read the calendar.')),
          h('div', { class: 'row' }, input, h('button', { class: 'btn primary', onclick: () => addFeed(input) }, 'Add')),
          ...s.feeds.map((feed, i) => h('div', { class: 'list-row' },
            h('span', { class: 'cal-dot', style: `background:${COLORS[i % COLORS.length]}` }),
            h('span', { class: 'grow ellipsis' }, feed.name, feed.error ? h('span', { class: 'cal-error' }, ' – could not load') : null),
            h('button', { class: 'x', title: 'Remove', onclick: () => { s.feeds.splice(i, 1); ctx.save(); render(); refresh(); } }, '×'))),
          s.feeds.length ? h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { class: 'btn', onclick: () => { showSetup = false; render(); } }, 'Done')) : null));
      }

      function render() {
        if (location.protocol === 'file:') {
          return view.replaceChildren(h('div', { class: 'empty' }, 'The calendar needs the dashboard to be opened with start.command, not by double-clicking index.html.'));
        }
        if (showSetup) return renderSetup();
        if (!loaded) return view.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
        const failed = s.feeds.filter(f => f.error).length;
        const now = Date.now(), today = dayStart(now);
        const rows = [];
        let lastDay = null;
        for (const e of events) {
          if (e.end <= now && !(e.allDay && e.end > today)) continue; // already over
          const day = Math.max(dayStart(e.start), today);
          if (day !== lastDay) { rows.push(h('div', { class: 'cal-day' + (day === today ? ' today' : '') }, dayLabel(day, today))); lastDay = day; }
          const live = !e.allDay && e.start <= now && e.end > now;
          rows.push(h('div', { class: 'cal-event' + (live ? ' live' : '') },
            h('span', { class: 'cal-dot', style: `background:${e.color}` }),
            h('span', { class: 'cal-time' }, e.allDay ? 'All day' : timeText(e.start)),
            h('span', { class: 'grow' }, e.summary, e.location ? h('div', { class: 'cal-where ellipsis' }, e.location) : null)));
        }
        if (failed) rows.unshift(h('div', { class: 'cal-error' }, failed === s.feeds.length ? 'Could not load the calendar. Check the address under Calendars.' : 'One calendar could not be loaded.'));
        if (!rows.length) rows.push(h('div', { class: 'empty' }, `Nothing in the next ${s.days} days.`));
        view.replaceChildren(...rows);
      }

      render();
      if (s.feeds.length) refresh();
      ctx.every(10 * 60000, refresh);
      ctx.every(60000, () => { if (!showSetup && loaded) render(); });
    },
  });

  Dash.calendarInternals = { parseICS, upcoming }; // exposed for testing in the console
})();
