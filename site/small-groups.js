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

// Anonymous posts are shown with a Bible name, picked from the post's id (so it stays the same for that post
// but says nothing about who wrote it, and two posts by one person usually get different names).
export const BIBLE_NAMES = Object.freeze(['Abraham', 'Sarah', 'Isaac', 'Rebekah', 'Jacob', 'Rachel', 'Leah', 'Joseph', 'Moses', 'Miriam', 'Aaron', 'Joshua', 'Caleb', 'Deborah', 'Gideon', 'Ruth', 'Naomi', 'Boaz', 'Hannah', 'Samuel', 'David', 'Jonathan', 'Abigail', 'Solomon', 'Elijah', 'Elisha', 'Esther', 'Mordecai', 'Nehemiah', 'Ezra', 'Daniel', 'Isaiah', 'Jeremiah', 'Jonah', 'Micah', 'Noah', 'Enoch', 'Job', 'Mary', 'Martha', 'Lazarus', 'Peter', 'Andrew', 'James', 'John', 'Philip', 'Thomas', 'Matthew', 'Barnabas', 'Silas', 'Timothy', 'Titus', 'Lydia', 'Priscilla', 'Aquila', 'Stephen', 'Zacchaeus', 'Dorcas', 'Phoebe', 'Luke']);
// `avoid`: real members' first names, so an anonymous post is never mistaken for a real person
export function bibleName(id, avoid = []) {
  let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const skip = new Set(avoid.map(n => String(n).toLowerCase()));
  for (let i = 0; i < BIBLE_NAMES.length; i++) { const n = BIBLE_NAMES[(h + i) % BIBLE_NAMES.length]; if (!skip.has(n.toLowerCase())) return n; }
  return 'Friend';
}

// YouVersion (bible.com) links — they open the YouVersion Bible app when it's installed.
const BOOKS = [['GEN','genesis gen'],['EXO','exodus exod ex'],['LEV','leviticus lev'],['NUM','numbers num'],['DEU','deuteronomy deut dt'],['JOS','joshua josh'],['JDG','judges judg'],['RUT','ruth'],['1SA','1 samuel 1samuel 1 sam 1sam'],['2SA','2 samuel 2samuel 2 sam 2sam'],['1KI','1 kings 1kings 1 kgs'],['2KI','2 kings 2kings 2 kgs'],['1CH','1 chronicles 1chronicles 1 chr'],['2CH','2 chronicles 2chronicles 2 chr'],['EZR','ezra'],['NEH','nehemiah neh'],['EST','esther esth'],['JOB','job'],['PSA','psalms psalm ps psa'],['PRO','proverbs proverb prov pr'],['ECC','ecclesiastes eccl ecc'],['SNG','song of songs song of solomon song'],['ISA','isaiah isa'],['JER','jeremiah jer'],['LAM','lamentations lam'],['EZK','ezekiel ezek'],['DAN','daniel dan'],['HOS','hosea hos'],['JOL','joel'],['AMO','amos'],['OBA','obadiah obad'],['JON','jonah'],['MIC','micah mic'],['NAM','nahum nah'],['HAB','habakkuk hab'],['ZEP','zephaniah zeph'],['HAG','haggai hag'],['ZEC','zechariah zech'],['MAL','malachi mal'],['MAT','matthew matt mt'],['MRK','mark mk'],['LUK','luke lk'],['JHN','john jn'],['ACT','acts'],['ROM','romans rom'],['1CO','1 corinthians 1corinthians 1 cor 1cor'],['2CO','2 corinthians 2corinthians 2 cor 2cor'],['GAL','galatians gal'],['EPH','ephesians eph'],['PHP','philippians phil'],['COL','colossians col'],['1TH','1 thessalonians 1thessalonians 1 thess'],['2TH','2 thessalonians 2thessalonians 2 thess'],['1TI','1 timothy 1timothy 1 tim'],['2TI','2 timothy 2timothy 2 tim'],['TIT','titus'],['PHM','philemon phlm'],['HEB','hebrews heb'],['JAS','james jas'],['1PE','1 peter 1peter 1 pet'],['2PE','2 peter 2peter 2 pet'],['1JN','1 john 1john 1 jn'],['2JN','2 john 2john'],['3JN','3 john 3john'],['JUD','jude'],['REV','revelation revelations rev']];
const BOOK_INDEX = new Map();
for (const [code, names] of BOOKS) for (const n of names.match(/(?:[123] )?[a-z]+(?: of [a-z]+)?/g)) if (!BOOK_INDEX.has(n)) BOOK_INDEX.set(n, code);
export const YOUVERSION = Object.freeze({ home: 'https://www.bible.com/bible/111/GEN.1', verseOfDay: 'https://www.bible.com/verse-of-the-day' });
export function youVersionUrl(ref) {
  const m = String(ref || '').trim().toLowerCase().replace(/[–—]/g, '-').match(/^([123]?\s*[a-z]+(?:\s+of\s+[a-z]+)?)\.?\s*(\d+)(?::(\d+)(?:-(\d+))?)?/);
  const code = m && BOOK_INDEX.get(m[1].replace(/^([123])\s*/, '$1 ').trim());
  if (!code) return ref ? `https://www.bible.com/search/bible?query=${encodeURIComponent(ref)}` : YOUVERSION.home;
  return `https://www.bible.com/bible/111/${code}.${m[2]}${m[3] ? '.' + m[3] + (m[4] ? '-' + m[4] : '') : ''}`;
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
  let prayerComments = [], openPrayerComments = new Set();
  const me = () => ctx?.user?.uid;
  const isLeader = () => ctx?.membership?.role === 'leader';
  const isMine = x => x.uid === me() || (x.anon && mine.has(x.id));
  const realNames = () => Object.values(ctx?.members || {}).map(m => String(m.name || '').split(/\s+/)[0]);
  const author = x => x.anon ? (mine.has(x.id) ? `You (as ${bibleName(x.id, realNames())})` : `🕊 ${bibleName(x.id, realNames())}`) : x.uid === me() ? 'You' : (ctx?.members?.[x.uid]?.name || 'A former member');
  const firstName = uid => uid === me() ? 'You' : (ctx?.members?.[uid]?.name || 'Someone').split(/\s+/)[0];

  function reset() {
    gen++; stops.forEach(f => f()); stops = []; dialog?.remove(); dialog = null;
    ctx = null; key = ''; events = []; prayers = []; devotions = []; comments = []; mine = new Set(); prayerComments = []; openPrayerComments = new Set();
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
    stops.push(api.watchPrayerComments(live(list => { prayerComments = list.sort((a, b) => a.createdAt - b.createdAt); render(); })));
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

  // comments under a devotion or a prayer request (kind: 'dev' | 'prayer')
  function commentBlock(kind, parentId, list) {
    return `<div class="sg-comments">${list.map(c => `<div class="sg-comment"><div><b>${esc(author(c))}</b> <span class="sg-muted">${esc(ago(c.createdAt))}</span></div><p>${esc(c.text)}</p>${isMine(c) || isLeader() ? `<button class="link-btn danger" data-sg="delComment" data-kind="${kind}" data-parent="${esc(parentId)}" data-id="${esc(c.id)}">Delete</button>` : ''}</div>`).join('') || '<p class="sg-muted">No comments yet.</p>'}
      <form class="sg-cform" data-cform="${kind}:${esc(parentId)}"><textarea maxlength="1000" rows="1" placeholder="${kind === 'prayer' ? 'Write an encouragement or “Praying for you!”' : 'Write a comment…'}" required></textarea>
        <div class="sg-cform-row"><label class="sg-check sm" title="Shown with a Bible name instead of yours"><input type="checkbox" name="anon"> Anonymous 🕊</label><button class="btn" type="submit">Send</button></div></form></div>`;
  }
  function devotionPage() {
    let html = `<button class="compose-btn" data-sg="newDevotion">＋ Share what moved you today</button>`;
    if (!devLoaded) return html + '<p role="status">Loading…</p>';
    if (!devotions.length) return html + `<div class="empty">No devotions yet. Share what God showed you or how you were moved today 📖</div>`;
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
      ${d.ref ? `<a class="sg-dev-ref" href="${esc(youVersionUrl(d.ref))}" target="_blank" rel="noopener">📖 ${esc(d.ref)} <small>· YouVersion ↗</small></a>` : ''}
      ${d.verse ? `<blockquote class="sg-dev-verse">${esc(d.verse)}</blockquote>` : ''}
      <p>${esc(d.body)}</p>
      <div class="sg-dev-bar">
        <button data-sg="like" data-id="${esc(d.id)}" class="${did ? 'on' : ''}" aria-pressed="${did}">${did ? '❤️' : '🤍'} ${d.likeCount || 0}</button>
        <button data-sg="comments" data-id="${esc(d.id)}" aria-expanded="${open}">💬 ${cs.length}</button>
        ${isMine(d) || isLeader() ? `<button class="link-btn danger" data-sg="delDevotion" data-id="${esc(d.id)}">Delete</button>` : ''}
      </div>
      ${open ? commentBlock('dev', d.id, cs) : ''}
    </article>`;
  }

  function prayerPage() {
    const list = prayers.filter(p => p.status === prayerFilter);
    const n = { active: prayers.filter(p => p.status === 'active').length, answered: prayers.filter(p => p.status === 'answered').length };
    const card = p => {
      if (p.locked) return `<article class="sg-card"><p class="sg-muted">🔒 Waiting for access…</p></article>`;
      const can = isMine(p) || isLeader(), did = prayed.has(p.id), pcs = prayerComments.filter(c => c.pid === p.id && !c.locked);
      return `<article class="sg-card sg-prayer ${p.status === 'answered' ? 'answered' : ''}">
        <div class="sg-prayer-top"><span class="sg-chip">${esc(p.category)}</span>${p.privacy === 'leaders' ? '<span class="sg-chip lock">🔒 Leaders only</span>' : ''}<span class="sg-chip ${p.status === 'answered' ? 'ok' : ''}">${p.status === 'answered' ? 'Answered' : 'Active'}</span></div>
        <h3>${esc(p.title)}</h3><p>${esc(p.request)}</p>
        ${p.status === 'answered' && p.testimony ? `<div class="sg-testimony"><b>🎉 How God answered</b><p>${esc(p.testimony)}</p></div>` : ''}
        <div class="sg-prayer-meta">${esc(author(p))} · ${esc(ago(p.createdAt))} · 🙏 ${p.prayedCount} ${p.prayedCount === 1 ? 'person' : 'people'} praying</div>
        <div class="sg-actions">${p.status === 'active' ? `<button class="btn ${did ? 'secondary' : ''}" data-sg="pray" data-id="${esc(p.id)}" ${did ? 'disabled' : ''}>${did ? '✓ You prayed' : '🙏 I Prayed'}</button>` : ''}
          <button class="btn secondary" data-sg="pcomments" data-id="${esc(p.id)}" aria-expanded="${openPrayerComments.has(p.id)}">💬 ${pcs.length}</button></div>
        ${can ? `<div class="sg-actions sg-small"><button class="link-btn" data-sg="answer" data-id="${esc(p.id)}">${p.status === 'answered' ? (p.testimony ? 'Edit answered note' : 'Add how it was answered') : '✓ Mark as answered'}</button><button class="link-btn danger" data-sg="delPrayer" data-id="${esc(p.id)}">Delete</button></div>` : ''}
        ${openPrayerComments.has(p.id) ? commentBlock('prayer', p.id, pcs) : ''}
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
        ${isLeader() || (ctx.membership?.canPost && e.uid === me()) ? `<div class="sg-actions sg-small"><button class="link-btn" data-ev="edit" data-id="${esc(e.id)}">Edit</button><button class="link-btn danger" data-ev="del" data-id="${esc(e.id)}">Delete</button></div>` : ''}
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
  const anonBox = text => `<label class="sg-check"><input type="checkbox" name="anon"><span><b>Post anonymously</b><br><small class="sg-muted">${text} You'll appear as a Bible name like “Ruth” or “Barnabas”.</small></span></label>`;
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
    form(`<h2>Today's devotion 📖</h2><p class="sg-muted">Share a verse, what moved you today, or what God is teaching you.</p>
      <label>Bible passage (optional)<input name="ref" maxlength="100" placeholder="e.g. Psalm 23:1–3"></label>
      <label>Verse (optional)<textarea name="verse" maxlength="1500" rows="3" placeholder="Type or paste the verse"></textarea></label>
      <label>What moved me today<textarea name="body" maxlength="3000" required placeholder="A thought, something that touched your heart, a lesson, a prayer…"></textarea></label>
      <p class="sg-muted">Need a verse? Today's Verse of the Day is on the News and Bible tabs.</p>
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
    form(`<h2>Answered prayer 🎉</h2><p class="sg-muted">${esc(p.title)}</p>
      <label>How did God answer? (optional)<textarea name="t" maxlength="500" placeholder="A short note for your group">${esc(p.testimony)}</textarea></label>${buttons(was ? 'Save' : 'Mark as answered')}`,
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
      else if (a === 'comments') { openComments.has(id) ? openComments.delete(id) : openComments.add(id); render(); root.querySelector(`[data-cform="dev:${CSS.escape(id)}"] textarea`)?.focus(); }
      else if (a === 'delDevotion') { if (await confirm('Delete this devotion?', 'Delete', true)) { await getApi().deleteDevotion(id); toast('Deleted'); } }
      else if (a === 'delComment') { if (await confirm('Delete this comment?', 'Delete', true)) { b.dataset.kind === 'prayer' ? await getApi().deletePrayerComment(b.dataset.parent, id) : await getApi().deleteComment(id); toast('Deleted'); } }
      else if (a === 'pcomments') { openPrayerComments.has(id) ? openPrayerComments.delete(id) : openPrayerComments.add(id); render(); root.querySelector(`[data-cform="prayer:${CSS.escape(id)}"] textarea`)?.focus(); }
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
    const [kind, parent] = [f.dataset.cform.slice(0, f.dataset.cform.indexOf(':')), f.dataset.cform.slice(f.dataset.cform.indexOf(':') + 1)];
    try { validateComment(text); kind === 'prayer' ? await getApi().addPrayerComment(parent, text, anon) : await getApi().addComment(parent, text, anon); ta.value = ''; ta.blur(); }
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
