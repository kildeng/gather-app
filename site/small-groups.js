// Small Group: one shared space for everyone in this group (church / youth group).
// Leaders post meetings, worship and events; everyone answers Going / Maybe / Can't go,
// shares prayer requests and sees who's in the group. Titles, details and prayers are
// end-to-end encrypted with the group key (like announcements); the data layer handles that.

export const EVENT_KINDS = Object.freeze(['Meeting', 'Worship', 'Event']);
export const PRAYER_CATEGORIES = Object.freeze(['Personal', 'Family', 'Health', 'School', 'Work', 'Faith', 'Other']);
export const RSVP = Object.freeze({ going: 'Going', maybe: 'Maybe', no: "Can't go" });

export function validateEvent(e) {
  if (!EVENT_KINDS.includes(e.kind)) throw new Error('Choose a type.');
  if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 80) throw new Error('Please add a title (up to 80 characters).');
  if (typeof e.location !== 'string' || e.location.length > 160) throw new Error('Location is too long.');
  if (typeof e.description !== 'string' || e.description.length > 1000) throw new Error('Details are too long (up to 1000 characters).');
  if (!Number.isFinite(e.startAt)) throw new Error('Choose a date and time.');
  return e;
}
export function validatePrayer(p) {
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 80) throw new Error('Please add a short title (up to 80 characters).');
  if (typeof p.request !== 'string' || !p.request.trim() || p.request.length > 1000) throw new Error('Please write your prayer request (up to 1000 characters).');
  if (!PRAYER_CATEGORIES.includes(p.category)) throw new Error('Choose a category.');
  if (!['group', 'leaders'].includes(p.privacy)) throw new Error('Choose who can see this request.');
  return p;
}
// Members ask the server only for what the security rules let them see:
// everyone's group-wide requests plus their own. Leaders can read everything.
export function prayerQueries(isLeader) {
  return isLeader ? [[]] : [[['privacy', '==', 'group']], [['uid', '==', '$me']]];
}
// Who answered what. Only approved members of the group are counted.
export function rsvpSummary(rsvp = {}, members = {}) {
  const out = { going: [], maybe: [], no: [] };
  for (const [uid, r] of Object.entries(rsvp)) if (out[r] && ['member', 'leader'].includes(members[uid]?.role)) out[r].push(uid);
  return out;
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const time = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const ago = ms => { const d = Date.now() - ms; if (d < 6e4) return 'Just now'; if (d < 36e5) return Math.floor(d / 6e4) + 'm ago'; if (d < 864e5) return Math.floor(d / 36e5) + 'h ago'; return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const pad = n => String(n).padStart(2, '0');
const localInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const KIND_ICON = { Meeting: '👥', Worship: '🙌', Event: '🎉' };
const PAST = 6 * 3600e3;   // an event stays "upcoming" until 6 hours after it starts

export function createCommunityUI({ root, getContext, getApi, sheet, toast, changed, confirm }) {
  let ctx = null, key = '', page = 'events', stops = [], gen = 0, dialog = null;
  let events = [], eventsLoaded = false, prayers = [], prayersLoaded = false, prayed = new Set(), prayerFilter = 'active', showPast = false;
  const me = () => ctx?.user?.uid;
  const isLeader = () => ctx?.membership?.role === 'leader';
  const nameOf = uid => uid === me() ? 'You' : (ctx?.members?.[uid]?.name || 'A former member');
  const firstName = uid => uid === me() ? 'You' : (ctx?.members?.[uid]?.name || 'Someone').split(/\s+/)[0];

  function reset() {
    gen++; stops.forEach(f => f()); stops = []; dialog?.remove(); dialog = null;
    ctx = null; key = ''; events = []; prayers = []; eventsLoaded = prayersLoaded = false; prayed = new Set();
    root.replaceChildren(); changed?.();
  }
  function sync() {
    const c = getContext();
    if (!c.user || !c.churchId || !['member', 'leader'].includes(c.membership?.role)) { if (ctx) reset(); return; }
    const k = `${c.churchId}:${c.user.uid}:${c.membership.role}`;
    ctx = c;
    if (k === key) { render(); return; }
    const keepPage = page;
    reset(); ctx = c; key = k; page = keepPage;
    const g = gen, api = getApi();
    stops.push(api.watchEvents(list => { if (g !== gen) return; events = list; eventsLoaded = true; render(); changed?.(); },
      () => { if (g !== gen) return; eventsLoaded = true; events = []; render(); }));
    stops.push(api.watchPrayers(isLeader(), list => {
      if (g !== gen) return;
      prayers = list.sort((a, b) => b.createdAt - a.createdAt); prayersLoaded = true;
      for (const p of list) if (!prayed.has(p.id)) api.prayedByMe(p.id).then(y => { if (y && g === gen) { prayed.add(p.id); render(); } }).catch(() => {});
      render(); changed?.();
    }, () => { if (g !== gen) return; prayersLoaded = true; prayers = []; render(); }));
    render();
  }

  /* ---------- render ---------- */
  function render() {
    if (!ctx) return;
    const tabs = [['events', 'Events'], ['prayer', 'Prayer'], ['members', 'Members']];
    root.innerHTML = `<div class="sg-intro compact"><span class="sg-eyebrow">${esc(ctx.groupName || 'Our group')}</span><p>Know each other. Pray for each other. Grow together.</p></div>
      <div class="sg-nav">${tabs.map(([k, l]) => `<button data-sg="tab" data-k="${k}" class="${page === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="sg-page">${page === 'events' ? eventsPage() : page === 'prayer' ? prayerPage() : membersPage()}</div>`;
  }

  function eventsPage() {
    const now = Date.now();
    const upcoming = events.filter(e => e.startAt > now - PAST).sort((a, b) => a.startAt - b.startAt);
    const past = events.filter(e => e.startAt <= now - PAST).sort((a, b) => b.startAt - a.startAt);
    return (isLeader() ? '<button class="compose-btn" data-sg="newEvent">＋ New event</button>' : '') +
      (!eventsLoaded ? '<p role="status">Loading events…</p>' :
        upcoming.length ? upcoming.map(e => eventCard(e, false)).join('') : `<div class="empty">No upcoming events.${isLeader() ? ' Tap “New event” to add a meeting or worship time.' : ' Your leaders will post meetings and events here.'}</div>`) +
      (past.length ? `<button class="link-btn sg-past-toggle" data-sg="past">${showPast ? 'Hide past events' : `Show past events (${past.length})`}</button>${showPast ? past.map(e => eventCard(e, true)).join('') : ''}` : '');
  }
  function eventCard(e, isPast) {
    if (e.locked) return `<article class="sg-card"><p class="sg-muted">🔒 Waiting for access. A leader's app shares the key the next time it opens.</p></article>`;
    const s = rsvpSummary(e.rsvp, ctx.members), mine = e.rsvp?.[me()] || '';
    const names = list => list.map(firstName).join(', ');
    return `<article class="sg-card sg-event ${isPast ? 'past' : ''}">
      <div class="sg-event-date"><b>${esc(new Date(e.startAt).toLocaleDateString('en-US', { month: 'short' }))}</b><span>${new Date(e.startAt).getDate()}</span></div>
      <div class="sg-event-body">
        <span class="sg-chip">${KIND_ICON[e.kind] || ''} ${esc(e.kind)}</span>
        <h3>${esc(e.title)}</h3>
        <div class="sg-event-meta">🕒 ${esc(day(e.startAt))} · ${esc(time(e.startAt))}${e.location ? `<br>📍 ${esc(e.location)}` : ''}</div>
        ${e.description ? `<p>${esc(e.description)}</p>` : ''}
        ${isPast ? '' : `<div class="sg-rsvp" role="group" aria-label="Will you come?">${Object.entries(RSVP).map(([k, l]) => `<button data-sg="rsvp" data-id="${esc(e.id)}" data-r="${k}" class="${mine === k ? 'on ' + k : ''}" aria-pressed="${mine === k}">${l}</button>`).join('')}</div>`}
        <details class="sg-who"><summary>✅ ${s.going.length} going · 🤔 ${s.maybe.length} maybe · ${s.no.length} can't go</summary>
          ${s.going.length ? `<p><b>Going:</b> ${esc(names(s.going))}</p>` : ''}${s.maybe.length ? `<p><b>Maybe:</b> ${esc(names(s.maybe))}</p>` : ''}${s.no.length ? `<p><b>Can't go:</b> ${esc(names(s.no))}</p>` : ''}
          ${!s.going.length && !s.maybe.length && !s.no.length ? '<p class="sg-muted">No answers yet.</p>' : ''}</details>
        ${isLeader() ? `<div class="sg-actions sg-small"><button class="link-btn" data-sg="editEvent" data-id="${esc(e.id)}">Edit</button><button class="link-btn danger" data-sg="delEvent" data-id="${esc(e.id)}">Delete</button></div>` : ''}
      </div></article>`;
  }

  function prayerPage() {
    const list = prayers.filter(p => p.status === prayerFilter);
    const n = { active: prayers.filter(p => p.status === 'active').length, answered: prayers.filter(p => p.status === 'answered').length };
    const card = p => {
      if (p.locked) return `<article class="sg-card"><p class="sg-muted">🔒 Waiting for access…</p></article>`;
      const mine = p.uid === me(), can = mine || isLeader(), did = prayed.has(p.id);
      return `<article class="sg-card sg-prayer ${p.status === 'answered' ? 'answered' : ''}">
        <div class="sg-prayer-top"><span class="sg-chip">${esc(p.category)}</span>${p.privacy === 'leaders' ? '<span class="sg-chip lock">🔒 Leaders only</span>' : ''}<span class="sg-chip ${p.status === 'answered' ? 'ok' : ''}">${p.status === 'answered' ? 'Answered' : 'Active'}</span></div>
        <h3>${esc(p.title)}</h3><p>${esc(p.request)}</p>
        ${p.status === 'answered' && p.testimony ? `<div class="sg-testimony"><b>Testimony</b><p>${esc(p.testimony)}</p></div>` : ''}
        <div class="sg-prayer-meta">${esc(nameOf(p.uid))} · ${esc(ago(p.createdAt))} · 🙏 ${p.prayedCount} ${p.prayedCount === 1 ? 'person' : 'people'} praying</div>
        <div class="sg-actions">${p.status === 'active' ? `<button class="btn ${did ? 'secondary' : ''}" data-sg="pray" data-id="${esc(p.id)}" ${did ? 'disabled' : ''}>${did ? '✓ You prayed' : '🙏 I Prayed'}</button>` : ''}
          ${can ? `<button class="btn secondary" data-sg="answer" data-id="${esc(p.id)}">${p.status === 'answered' ? (p.testimony ? 'Edit testimony' : 'Add testimony') : 'Mark as answered'}</button><button class="link-btn danger" data-sg="delPrayer" data-id="${esc(p.id)}">Delete</button>` : ''}</div>
      </article>`;
    };
    return `<button class="compose-btn" data-sg="newPrayer">＋ Share a prayer request</button>
      <div class="sg-nav sg-sub"><button data-sg="pf" data-k="active" class="${prayerFilter === 'active' ? 'on' : ''}">Active · ${n.active}</button><button data-sg="pf" data-k="answered" class="${prayerFilter === 'answered' ? 'on' : ''}">Answered · ${n.answered}</button></div>
      ${!prayersLoaded ? '<p role="status">Loading prayer requests…</p>' : list.length ? list.map(card).join('') : `<div class="empty">${prayerFilter === 'active' ? 'No prayer requests right now. Be the first to share one.' : 'No answered prayers yet.'}</div>`}
      <p class="sg-muted">🔒 Prayer requests are end-to-end encrypted. “Leaders only” requests can be opened only by you and your group's leaders.</p>`;
  }

  function membersPage() {
    const list = Object.entries(ctx.members || {}).filter(([, m]) => ['member', 'leader'].includes(m.role))
      .sort(([, a], [, b]) => (b.role === 'leader') - (a.role === 'leader') || a.name.localeCompare(b.name, 'en'));
    return `<p class="sg-muted">${list.length} ${list.length === 1 ? 'person' : 'people'} in ${esc(ctx.groupName || 'this group')}</p><div class="sg-directory">${list.map(([uid, m]) => `<article class="sg-member"><div class="avatar">${/^https:\/\//.test(m.photo || '') ? `<img src="${esc(m.photo)}" alt="" referrerpolicy="no-referrer">` : esc((m.name || '?').slice(0, 1))}</div><div><h3>${esc(m.name)}${uid === me() ? ' <small class="sg-muted">(you)</small>' : ''}</h3><span class="sg-muted">${m.role === 'leader' ? 'Leader' : 'Member'}</span></div></article>`).join('')}</div>`;
  }

  /* ---------- actions ---------- */
  const fail = (bg, err) => { const el = bg.querySelector('.sg-error'); if (el) el.textContent = err?.message === 'no-key' ? 'Waiting for access to this group. Try again in a moment.' : err?.code === 'permission-denied' ? "You don't have permission to do that." : (err?.message || 'Something went wrong. Please try again.'); };
  function eventForm(id) {
    const e = events.find(x => x.id === id);
    const start = e?.startAt || (() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); d.setHours(19, 30, 0, 0); return d.getTime(); })();
    dialog?.remove();
    const bg = dialog = sheet(`<form class="sg-form scroll"><h2>${e ? 'Edit event' : 'New event'}</h2>
      <label>Type<select name="kind">${EVENT_KINDS.map(k => `<option ${e?.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label>Title<input name="title" maxlength="80" required value="${esc(e?.title || '')}" placeholder="e.g. Friday Night Gathering"></label>
      <label>Date & time<input name="startAt" type="datetime-local" required value="${localInput(start)}"></label>
      <label>Location<input name="location" maxlength="160" value="${esc(e?.location || '')}" placeholder="e.g. Education Building, 2nd floor"></label>
      <label>Details<textarea name="description" maxlength="1000" placeholder="What should people know or bring?">${esc(e?.description || '')}</textarea></label>
      <p class="sg-error" role="alert"></p>
      <div class="sg-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">${e ? 'Save' : 'Post event'}</button></div></form>`);
    bg.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); const f = new FormData(ev.currentTarget), btn = ev.currentTarget.querySelector('[type=submit]');
      const data = { kind: f.get('kind'), title: String(f.get('title') || '').trim(), location: String(f.get('location') || '').trim(), description: String(f.get('description') || '').trim(), startAt: new Date(String(f.get('startAt'))).getTime() };
      btn.disabled = true;
      try { validateEvent(data); await getApi().saveEvent(id || null, data); bg.remove(); toast(e ? 'Event updated' : 'Event posted'); }
      catch (err) { fail(bg, err); btn.disabled = false; }
    });
  }
  function prayerForm() {
    dialog?.remove();
    const bg = dialog = sheet(`<form class="sg-form scroll"><h2>Share a prayer request</h2>
      <label>Title<input name="title" maxlength="80" required placeholder="e.g. School"></label>
      <label>Prayer request<textarea name="request" maxlength="1000" required placeholder="What can your group pray for?"></textarea></label>
      <label>Category<select name="category">${PRAYER_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></label>
      <fieldset><legend>Who can see this?</legend>
        <label class="sg-check"><input type="radio" name="privacy" value="group" checked><span><b>Everyone in ${esc(ctx.groupName || 'the group')}</b></span></label>
        <label class="sg-check"><input type="radio" name="privacy" value="leaders"><span><b>Leaders only</b><br><small class="sg-muted">Only the group's leaders can open it</small></span></label></fieldset>
      <p class="sg-error" role="alert"></p>
      <div class="sg-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">Share</button></div></form>`);
    bg.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); const f = new FormData(ev.currentTarget), btn = ev.currentTarget.querySelector('[type=submit]');
      const data = { title: String(f.get('title') || '').trim(), request: String(f.get('request') || '').trim(), category: f.get('category'), privacy: f.get('privacy') };
      btn.disabled = true;
      try { validatePrayer(data); await getApi().addPrayer(data); bg.remove(); prayerFilter = 'active'; render(); toast('Prayer request shared'); }
      catch (err) { fail(bg, err); btn.disabled = false; }
    });
  }
  async function pray(id) {
    if (prayed.has(id)) return;
    prayed.add(id); render();
    try { await getApi().pray(id); toast('Thank you for praying 🙏'); }
    catch { const y = await getApi().prayedByMe(id).catch(() => false); if (!y) { prayed.delete(id); toast('Could not save. Please try again.'); } render(); }
  }
  function answer(id) {
    const p = prayers.find(x => x.id === id); if (!p) return;
    const was = p.status === 'answered';
    dialog?.remove();
    const bg = dialog = sheet(`<form class="sg-form scroll"><h2>${was ? 'Testimony' : 'Answered prayer 🎉'}</h2><p class="sg-muted">${esc(p.title)}</p>
      <label>Share how God answered (optional)<textarea name="t" maxlength="500" placeholder="A short testimony for your group">${esc(p.testimony)}</textarea></label>
      <p class="sg-error" role="alert"></p>
      <div class="sg-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">${was ? 'Save' : 'Mark as answered'}</button></div></form>`);
    bg.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); const btn = ev.currentTarget.querySelector('[type=submit]'); btn.disabled = true;
      try { await getApi().answerPrayer(p, String(new FormData(ev.currentTarget).get('t') || '').trim().slice(0, 500)); bg.remove(); if (!was) { prayerFilter = 'answered'; render(); } toast(was ? 'Saved' : 'Praise God! Marked as answered'); }
      catch (err) { fail(bg, err); btn.disabled = false; }
    });
  }

  root.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-sg]'); if (!b || !ctx) return;
    const a = b.dataset.sg, id = b.dataset.id;
    try {
      if (a === 'tab') { page = b.dataset.k; render(); }
      else if (a === 'past') { showPast = !showPast; render(); }
      else if (a === 'newEvent' || a === 'editEvent') eventForm(id);
      else if (a === 'delEvent') { if (await confirm('Delete this event for everyone?', 'Delete', true)) { await getApi().deleteEvent(id); toast('Event deleted'); } }
      else if (a === 'rsvp') { const e = events.find(x => x.id === id), r = b.dataset.r; await getApi().setRsvp(id, e?.rsvp?.[me()] === r ? null : r); }
      else if (a === 'newPrayer') prayerForm();
      else if (a === 'pray') pray(id);
      else if (a === 'answer') answer(id);
      else if (a === 'delPrayer') { if (await confirm("Delete this prayer request? This can't be undone.", 'Delete', true)) { await getApi().deletePrayer(id); toast('Deleted'); } }
      else if (a === 'pf') { prayerFilter = b.dataset.k; render(); }
    } catch (err) { console.error(err); toast(err?.message === 'no-key' ? 'Waiting for access to this group. Try again in a moment.' : "That didn't work. Please try again."); }
  });

  return {
    sync, reset, render,
    // for the News home card: the next event and how many prayer requests are new (counts only, never content)
    nextEvent() { const now = Date.now(); return events.filter(e => !e.locked && e.startAt > now - PAST).sort((a, b) => a.startAt - b.startAt)[0] || null; },
    newPrayerCount(since) { return prayers.filter(p => p.status === 'active' && p.uid !== me() && p.createdAt > since).length; },
    myRsvp(e) { return e?.rsvp?.[me()] || ''; },
    show(p) { page = p; render(); }
  };
}
