// Group life, shared by everyone in this group (church / youth group):
//  • News tab: events leaders post, where people answer Going / Maybe / Can't go
//  • Small Group tab: Today's Devotion (likes + comments), Prayer requests, Members
// People can post devotions, comments and prayer requests anonymously.
// All text is end-to-end encrypted with the group key (like announcements); the data layer handles that.

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
  if (typeof p.anon !== 'boolean') throw new Error('Choose whether to post anonymously.');
  return p;
}
export function validateDevotion(d) {
  if (typeof d.ref !== 'string' || d.ref.length > 100) throw new Error('The Bible reference is too long.');
  if (typeof d.verse !== 'string' || d.verse.length > 1500) throw new Error('The verse text is too long.');
  if (typeof d.body !== 'string' || !d.body.trim() || d.body.length > 3000) throw new Error('Please write your reflection (up to 3000 characters).');
  if (typeof d.anon !== 'boolean') throw new Error('Choose whether to post anonymously.');
  return d;
}
export function validateComment(t) {
  if (typeof t !== 'string' || !t.trim() || t.length > 1000) throw new Error('Comments can be up to 1000 characters.');
  return t;
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
// "Today", "Yesterday" or a date — used to group devotions by day
export function dayLabel(ms, now = Date.now()) {
  const d = new Date(ms), t = new Date(now), y = new Date(now - 864e5);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const time = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const ago = ms => { const d = Date.now() - ms; if (d < 6e4) return 'Just now'; if (d < 36e5) return Math.floor(d / 6e4) + 'm ago'; if (d < 864e5) return Math.floor(d / 36e5) + 'h ago'; return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const pad = n => String(n).padStart(2, '0');
const localInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const KIND_ICON = { Meeting: '👥', Worship: '🙌', Event: '🎉' };
const PAST = 6 * 3600e3;   // an event stays "upcoming" until 6 hours after it starts

export function createCommunityUI({ root, newsRoot, getContext, getApi, sheet, toast, changed, confirm }) {
  let ctx = null, key = '', page = 'devotion', stops = [], gen = 0, dialog = null;
  let events = [], eventsLoaded = false, showPast = false;
  let prayers = [], prayersLoaded = false, prayed = new Set(), prayerFilter = 'active';
  let devotions = [], devLoaded = false, liked = new Set(), comments = [], openComments = new Set();
  let mine = new Set();   // ids of my own anonymous posts (from my private owner records)
  const me = () => ctx?.user?.uid;
  const isLeader = () => ctx?.membership?.role === 'leader';
  const isMine = x => x.uid === me() || (x.anon && mine.has(x.id));
  const author = x => x.anon ? (mine.has(x.id) ? 'You (anonymous)' : 'Anonymous 🕊') : x.uid === me() ? 'You' : (ctx?.members?.[x.uid]?.name || 'A former member');
  const firstName = uid => uid === me() ? 'You' : (ctx?.members?.[uid]?.name || 'Someone').split(/\s+/)[0];

  function reset() {
    gen++; stops.forEach(f => f()); stops = []; dialog?.remove(); dialog = null;
    ctx = null; key = ''; events = []; prayers = []; devotions = []; comments = []; mine = new Set();
    eventsLoaded = prayersLoaded = devLoaded = false; prayed = new Set(); liked = new Set(); openComments = new Set();
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
    const g = gen, api = getApi(), live = fn => (...a) => { if (g === gen) fn(...a); };
    stops.push(api.watchMine(live(ids => { mine = new Set(ids); render(); changed?.(); }), () => {}));
    stops.push(api.watchEvents(live(list => { events = list; eventsLoaded = true; render(); changed?.(); }), live(() => { eventsLoaded = true; render(); changed?.(); })));
    stops.push(api.watchPrayers(isLeader(), live(list => {
      prayers = list.sort((a, b) => b.createdAt - a.createdAt); prayersLoaded = true;
      for (const p of list) if (!prayed.has(p.id)) api.prayedByMe(p.id).then(live(y => { if (y) { prayed.add(p.id); render(); } })).catch(() => {});
      render(); changed?.();
    }), live(() => { prayersLoaded = true; render(); })));
    stops.push(api.watchDevotions(live(list => {
      devotions = list.sort((a, b) => b.createdAt - a.createdAt); devLoaded = true;
      for (const d of list) if (!liked.has(d.id)) api.likedByMe(d.id).then(live(y => { if (y) { liked.add(d.id); render(); } })).catch(() => {});
      render(); changed?.();
    }), live(() => { devLoaded = true; render(); })));
    stops.push(api.watchComments(live(list => { comments = list.sort((a, b) => a.createdAt - b.createdAt); render(); }), () => {}));
    render();
  }

  /* ---------- Small Group tab ---------- */
  function render() {
    if (!ctx) return;
    const tabs = [['devotion', "Today's Devotion"], ['prayer', 'Prayer'], ['members', 'Members']];
    const focus = document.activeElement?.closest?.('[data-cform]')?.dataset.cform, typed = focus ? document.activeElement.value : '';
    root.innerHTML = `<div class="sg-intro compact"><span class="sg-eyebrow">${esc(ctx.groupName || 'Our group')}</span><p>Know each other. Pray for each other. Grow together.</p></div>
      <div class="sg-nav">${tabs.map(([k, l]) => `<button data-sg="tab" data-k="${k}" class="${page === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="sg-page">${page === 'devotion' ? devotionPage() : page === 'prayer' ? prayerPage() : membersPage()}</div>`;
    if (focus) { const el = root.querySelector(`[data-cform="${focus}"] textarea`); if (el) { el.value = typed; el.focus(); } }
  }

  function devotionPage() {
    let html = `<button class="compose-btn" data-sg="newDevotion">＋ Share today's devotion</button>`;
    if (!devLoaded) return html + '<p role="status">Loading…</p>';
    if (!devotions.length) return html + `<div class="empty">No devotions yet. Share what God showed you in His Word today 📖</div>`;
    let last = '';
    for (const d of devotions) {
      const label = dayLabel(d.createdAt);
      if (label !== last) { html += `<div class="sg-day">${esc(label)}</div>`; last = label; }
      html += devotionCard(d);
    }
    return html;
  }
  function devotionCard(d) {
    if (d.locked) return `<article class="sg-card"><p class="sg-muted">🔒 Waiting for access…</p></article>`;
    const cs = comments.filter(c => c.did === d.id && !c.locked), open = openComments.has(d.id), did = liked.has(d.id);
    return `<article class="sg-card sg-dev">
      <div class="sg-dev-head"><b>${esc(author(d))}</b><span class="sg-muted">${esc(ago(d.createdAt))}</span></div>
      ${d.ref ? `<div class="sg-dev-ref">📖 ${esc(d.ref)}</div>` : ''}
      ${d.verse ? `<blockquote class="sg-dev-verse">${esc(d.verse)}</blockquote>` : ''}
      <p>${esc(d.body)}</p>
      <div class="sg-dev-bar">
        <button data-sg="like" data-id="${esc(d.id)}" class="${did ? 'on' : ''}" aria-pressed="${did}">${did ? '❤️' : '🤍'} ${d.likeCount || 0}</button>
        <button data-sg="comments" data-id="${esc(d.id)}" aria-expanded="${open}">💬 ${cs.length}</button>
        ${isMine(d) || isLeader() ? `<button class="link-btn danger" data-sg="delDevotion" data-id="${esc(d.id)}">Delete</button>` : ''}
      </div>
      ${open ? `<div class="sg-comments">${cs.map(c => `<div class="sg-comment"><div><b>${esc(author(c))}</b> <span class="sg-muted">${esc(ago(c.createdAt))}</span></div><p>${esc(c.text)}</p>${isMine(c) || isLeader() ? `<button class="link-btn danger" data-sg="delComment" data-id="${esc(c.id)}">Delete</button>` : ''}</div>`).join('') || '<p class="sg-muted">No comments yet.</p>'}
        <form class="sg-cform" data-cform="${esc(d.id)}"><textarea maxlength="1000" rows="1" placeholder="Write a comment…" required></textarea>
          <div class="sg-cform-row"><label class="sg-check sm"><input type="checkbox" name="anon"> Anonymous</label><button class="btn" type="submit">Send</button></div></form></div>` : ''}
    </article>`;
  }

  function prayerPage() {
    const list = prayers.filter(p => p.status === prayerFilter);
    const n = { active: prayers.filter(p => p.status === 'active').length, answered: prayers.filter(p => p.status === 'answered').length };
    const card = p => {
      if (p.locked) return `<article class="sg-card"><p class="sg-muted">🔒 Waiting for access…</p></article>`;
      const can = isMine(p) || isLeader(), did = prayed.has(p.id);
      return `<article class="sg-card sg-prayer ${p.status === 'answered' ? 'answered' : ''}">
        <div class="sg-prayer-top"><span class="sg-chip">${esc(p.category)}</span>${p.privacy === 'leaders' ? '<span class="sg-chip lock">🔒 Leaders only</span>' : ''}<span class="sg-chip ${p.status === 'answered' ? 'ok' : ''}">${p.status === 'answered' ? 'Answered' : 'Active'}</span></div>
        <h3>${esc(p.title)}</h3><p>${esc(p.request)}</p>
        ${p.status === 'answered' && p.testimony ? `<div class="sg-testimony"><b>Testimony</b><p>${esc(p.testimony)}</p></div>` : ''}
        <div class="sg-prayer-meta">${esc(author(p))} · ${esc(ago(p.createdAt))} · 🙏 ${p.prayedCount} ${p.prayedCount === 1 ? 'person' : 'people'} praying</div>
        <div class="sg-actions">${p.status === 'active' ? `<button class="btn ${did ? 'secondary' : ''}" data-sg="pray" data-id="${esc(p.id)}" ${did ? 'disabled' : ''}>${did ? '✓ You prayed' : '🙏 I Prayed'}</button>` : ''}
          ${can ? `<button class="btn secondary" data-sg="answer" data-id="${esc(p.id)}">${p.status === 'answered' ? (p.testimony ? 'Edit testimony' : 'Add testimony') : 'Mark as answered'}</button><button class="link-btn danger" data-sg="delPrayer" data-id="${esc(p.id)}">Delete</button>` : ''}</div>
      </article>`;
    };
    return `<button class="compose-btn" data-sg="newPrayer">＋ Share a prayer request</button>
      <div class="sg-nav sg-sub"><button data-sg="pf" data-k="active" class="${prayerFilter === 'active' ? 'on' : ''}">Active · ${n.active}</button><button data-sg="pf" data-k="answered" class="${prayerFilter === 'answered' ? 'on' : ''}">Answered · ${n.answered}</button></div>
      ${!prayersLoaded ? '<p role="status">Loading prayer requests…</p>' : list.length ? list.map(card).join('') : `<div class="empty">${prayerFilter === 'active' ? 'No prayer requests right now. Be the first to share one.' : 'No answered prayers yet.'}</div>`}
      <p class="sg-muted">🔒 End-to-end encrypted. Anonymous posts don't show your name to anyone, leaders included. “Leaders only” requests can be opened only by you and the group's leaders.</p>`;
  }

  function membersPage() {
    const list = Object.entries(ctx.members || {}).filter(([, m]) => ['member', 'leader'].includes(m.role))
      .sort(([, a], [, b]) => (b.role === 'leader') - (a.role === 'leader') || a.name.localeCompare(b.name, 'en'));
    return `<p class="sg-muted">${list.length} ${list.length === 1 ? 'person' : 'people'} in ${esc(ctx.groupName || 'this group')}</p><div class="sg-directory">${list.map(([uid, m]) => `<article class="sg-member"><div class="avatar">${/^https:\/\//.test(m.photo || '') ? `<img src="${esc(m.photo)}" alt="" referrerpolicy="no-referrer">` : esc((m.name || '?').slice(0, 1))}</div><div><h3>${esc(m.name)}${uid === me() ? ' <small class="sg-muted">(you)</small>' : ''}</h3><span class="sg-muted">${m.role === 'leader' ? 'Leader' : 'Member'}</span></div></article>`).join('')}</div>`;
  }

  /* ---------- News tab: events with Going / Maybe / Can't go ---------- */
  function eventsHTML() {
    if (!ctx) return '';
    const now = Date.now();
    const upcoming = events.filter(e => e.startAt > now - PAST).sort((a, b) => a.startAt - b.startAt);
    const past = events.filter(e => e.startAt <= now - PAST).sort((a, b) => b.startAt - a.startAt);
    if (!upcoming.length && !past.length) return '';
    return `<section class="ev-section"><div class="sec-title">Upcoming events</div>
      ${upcoming.length ? upcoming.map(e => eventCard(e, false)).join('') : '<p class="sg-muted">No upcoming events.</p>'}
      ${past.length ? `<button class="link-btn sg-past-toggle" data-ev="past">${showPast ? 'Hide past events' : `Show past events (${past.length})`}</button>${showPast ? past.map(e => eventCard(e, true)).join('') : ''}` : ''}</section>`;
  }
  function eventCard(e, isPast) {
    if (e.locked) return `<article class="sg-card"><p class="sg-muted">🔒 Waiting for access. A leader's app shares the key the next time it opens.</p></article>`;
    const s = rsvpSummary(e.rsvp, ctx.members), my = e.rsvp?.[me()] || '';
    const names = list => list.map(firstName).join(', ');
    return `<article class="sg-card sg-event ${isPast ? 'past' : ''}">
      <div class="sg-event-date"><b>${esc(new Date(e.startAt).toLocaleDateString('en-US', { month: 'short' }))}</b><span>${new Date(e.startAt).getDate()}</span></div>
      <div class="sg-event-body">
        <span class="sg-chip">${KIND_ICON[e.kind] || ''} ${esc(e.kind)}</span>
        <h3>${esc(e.title)}</h3>
        <div class="sg-event-meta">🕒 ${esc(day(e.startAt))} · ${esc(time(e.startAt))}${e.location ? `<br>📍 ${esc(e.location)}` : ''}</div>
        ${e.description ? `<p>${esc(e.description)}</p>` : ''}
        ${isPast ? '' : `<div class="sg-rsvp" role="group" aria-label="Will you come?">${Object.entries(RSVP).map(([k, l]) => `<button data-ev="rsvp" data-id="${esc(e.id)}" data-r="${k}" class="${my === k ? 'on ' + k : ''}" aria-pressed="${my === k}">${l}</button>`).join('')}</div>`}
        <details class="sg-who"><summary>✅ ${s.going.length} going · 🤔 ${s.maybe.length} maybe · ${s.no.length} can't go</summary>
          ${s.going.length ? `<p><b>Going:</b> ${esc(names(s.going))}</p>` : ''}${s.maybe.length ? `<p><b>Maybe:</b> ${esc(names(s.maybe))}</p>` : ''}${s.no.length ? `<p><b>Can't go:</b> ${esc(names(s.no))}</p>` : ''}
          ${!s.going.length && !s.maybe.length && !s.no.length ? '<p class="sg-muted">No answers yet.</p>' : ''}</details>
        ${isLeader() ? `<div class="sg-actions sg-small"><button class="link-btn" data-ev="edit" data-id="${esc(e.id)}">Edit</button><button class="link-btn danger" data-ev="del" data-id="${esc(e.id)}">Delete</button></div>` : ''}
      </div></article>`;
  }

  /* ---------- forms & actions ---------- */
  const fail = (bg, err) => { const el = bg.querySelector('.sg-error'); if (el) el.textContent = err?.message === 'no-key' ? 'Waiting for access to this group. Try again in a moment.' : err?.code === 'permission-denied' ? "You don't have permission to do that." : (err?.message || 'Something went wrong. Please try again.'); };
  const form = (html, onSubmit) => {
    dialog?.remove();
    const bg = dialog = sheet(`<form class="sg-form scroll">${html}<p class="sg-error" role="alert"></p></form>`);
    bg.querySelector('form').addEventListener('submit', async ev => {
      ev.preventDefault(); const btn = ev.currentTarget.querySelector('[type=submit]'); btn.disabled = true;
      try { await onSubmit(new FormData(ev.currentTarget)); bg.remove(); } catch (err) { fail(bg, err); btn.disabled = false; }
    });
    return bg;
  };
  const buttons = label => `<div class="sg-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">${label}</button></div>`;
  const anonBox = text => `<label class="sg-check"><input type="checkbox" name="anon"><span><b>Post anonymously</b><br><small class="sg-muted">${text}</small></span></label>`;
  function eventForm(id) {
    const e = events.find(x => x.id === id);
    const start = e?.startAt || (() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); d.setHours(19, 30, 0, 0); return d.getTime(); })();
    form(`<h2>${e ? 'Edit event' : 'New event'}</h2>
      <label>Type<select name="kind">${EVENT_KINDS.map(k => `<option ${e?.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label>Title<input name="title" maxlength="80" required value="${esc(e?.title || '')}" placeholder="e.g. Friday Night Gathering"></label>
      <label>Date & time<input name="startAt" type="datetime-local" required value="${localInput(start)}"></label>
      <label>Location<input name="location" maxlength="160" value="${esc(e?.location || '')}" placeholder="e.g. Education Building, 2nd floor"></label>
      <label>Details<textarea name="description" maxlength="1000" placeholder="What should people know or bring?">${esc(e?.description || '')}</textarea></label>
      <p class="sg-muted">Everyone in the group can tap Going, Maybe or Can't go.</p>${buttons(e ? 'Save' : 'Post event')}`,
    async f => { const data = { kind: f.get('kind'), title: String(f.get('title') || '').trim(), location: String(f.get('location') || '').trim(), description: String(f.get('description') || '').trim(), startAt: new Date(String(f.get('startAt'))).getTime() };
      validateEvent(data); await getApi().saveEvent(id || null, data); toast(e ? 'Event updated' : 'Event posted'); });
  }
  function devotionForm() {
    form(`<h2>Today's devotion 📖</h2>
      <label>Bible passage<input name="ref" maxlength="100" placeholder="e.g. Psalm 23:1–3"></label>
      <label>Verse (optional)<textarea name="verse" maxlength="1500" rows="3" placeholder="Type or paste the verse"></textarea></label>
      <label>What God showed me<textarea name="body" maxlength="3000" required placeholder="Your reflection, a lesson, a prayer…"></textarea></label>
      ${anonBox('Your name won’t be shown to anyone')}${buttons('Share')}`,
    async f => { const d = { ref: String(f.get('ref') || '').trim(), verse: String(f.get('verse') || '').trim(), body: String(f.get('body') || '').trim(), anon: f.get('anon') === 'on' };
      validateDevotion(d); await getApi().addDevotion(d); page = 'devotion'; render(); toast('Shared. Thank you!'); });
  }
  function prayerForm() {
    form(`<h2>Share a prayer request</h2>
      <label>Title<input name="title" maxlength="80" required placeholder="e.g. School"></label>
      <label>Prayer request<textarea name="request" maxlength="1000" required placeholder="What can your group pray for?"></textarea></label>
      <label>Category<select name="category">${PRAYER_CATEGORIES.map(c => `<option ${c === 'Other' ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <fieldset><legend>Who can see this?</legend>
        <label class="sg-check"><input type="radio" name="privacy" value="group" checked><span><b>Everyone in ${esc(ctx.groupName || 'the group')}</b></span></label>
        <label class="sg-check"><input type="radio" name="privacy" value="leaders"><span><b>Leaders only</b><br><small class="sg-muted">Only the group's leaders can open it</small></span></label></fieldset>
      ${anonBox('Nobody will see who posted it, leaders included')}${buttons('Share')}`,
    async f => { const p = { title: String(f.get('title') || '').trim(), request: String(f.get('request') || '').trim(), category: f.get('category'), privacy: f.get('privacy'), anon: f.get('anon') === 'on' };
      validatePrayer(p); await getApi().addPrayer(p); prayerFilter = 'active'; render(); toast('Prayer request shared'); });
  }
  function answerForm(id) {
    const p = prayers.find(x => x.id === id); if (!p) return;
    const was = p.status === 'answered';
    form(`<h2>${was ? 'Testimony' : 'Answered prayer 🎉'}</h2><p class="sg-muted">${esc(p.title)}</p>
      <label>Share how God answered (optional)<textarea name="t" maxlength="500" placeholder="A short testimony for your group">${esc(p.testimony)}</textarea></label>${buttons(was ? 'Save' : 'Mark as answered')}`,
    async f => { await getApi().answerPrayer(p, String(f.get('t') || '').trim().slice(0, 500)); if (!was) { prayerFilter = 'answered'; render(); } toast(was ? 'Saved' : 'Praise God! Marked as answered'); });
  }
  async function pray(id) {
    if (prayed.has(id)) return;
    prayed.add(id); render();
    try { await getApi().pray(id); toast('Thank you for praying 🙏'); }
    catch { const y = await getApi().prayedByMe(id).catch(() => false); if (!y) { prayed.delete(id); toast('Could not save. Please try again.'); } render(); }
  }
  async function like(id) {
    const on = liked.has(id), d = devotions.find(x => x.id === id);
    on ? liked.delete(id) : liked.add(id); if (d) d.likeCount = Math.max(0, (d.likeCount || 0) + (on ? -1 : 1)); render();
    try { await (on ? getApi().unlike(id) : getApi().like(id)); }
    catch { const y = await getApi().likedByMe(id).catch(() => on); y ? liked.add(id) : liked.delete(id); render(); }
  }
  const errMsg = err => err?.message === 'no-key' ? 'Waiting for access to this group. Try again in a moment.' : err?.code === 'permission-denied' ? "You don't have permission to do that." : (err?.message || "That didn't work. Please try again.");

  root.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-sg]'); if (!b || !ctx) return;
    const a = b.dataset.sg, id = b.dataset.id;
    try {
      if (a === 'tab') { page = b.dataset.k; render(); changed?.('tab:' + page); }
      else if (a === 'newDevotion') devotionForm();
      else if (a === 'like') like(id);
      else if (a === 'comments') { openComments.has(id) ? openComments.delete(id) : openComments.add(id); render(); root.querySelector(`[data-cform="${CSS.escape(id)}"] textarea`)?.focus(); }
      else if (a === 'delDevotion') { if (await confirm('Delete this devotion?', 'Delete', true)) { await getApi().deleteDevotion(id); toast('Deleted'); } }
      else if (a === 'delComment') { if (await confirm('Delete this comment?', 'Delete', true)) { await getApi().deleteComment(id); toast('Deleted'); } }
      else if (a === 'newPrayer') prayerForm();
      else if (a === 'pray') pray(id);
      else if (a === 'answer') answerForm(id);
      else if (a === 'delPrayer') { if (await confirm("Delete this prayer request? This can't be undone.", 'Delete', true)) { await getApi().deletePrayer(id); toast('Deleted'); } }
      else if (a === 'pf') { prayerFilter = b.dataset.k; render(); }
    } catch (err) { console.error(err); toast(errMsg(err)); }
  });
  root.addEventListener('submit', async ev => {
    const f = ev.target.closest('[data-cform]'); if (!f) return;
    ev.preventDefault();
    const ta = f.querySelector('textarea'), text = ta.value.trim(), anon = f.querySelector('[name=anon]').checked, btn = f.querySelector('[type=submit]');
    if (!text) return;
    btn.disabled = true;
    try { validateComment(text); await getApi().addComment(f.dataset.cform, text, anon); ta.value = ''; ta.blur(); }
    catch (err) { toast(errMsg(err)); }
    btn.disabled = false;
  });
  // events live on the News tab
  newsRoot.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-ev]'); if (!b || !ctx) return;
    const a = b.dataset.ev, id = b.dataset.id;
    try {
      if (a === 'new' || a === 'edit') eventForm(id);
      else if (a === 'past') { showPast = !showPast; changed?.(); }
      else if (a === 'del') { if (await confirm('Delete this event for everyone?', 'Delete', true)) { await getApi().deleteEvent(id); toast('Event deleted'); } }
      else if (a === 'rsvp') { const e = events.find(x => x.id === id), r = b.dataset.r; await getApi().setRsvp(id, e?.rsvp?.[me()] === r ? null : r); }
    } catch (err) { console.error(err); toast(errMsg(err)); }
  });

  return {
    sync, reset, render, eventsHTML,
    // for the News tab and badges: counts only, never prayer content
    newPrayerCount(since) { return prayers.filter(p => p.status === 'active' && !isMine(p) && p.createdAt > since).length; },
    newDevotionCount(since) { return devotions.filter(d => !isMine(d) && d.createdAt > since).length; },
    show(p) { page = p; render(); }
  };
}
