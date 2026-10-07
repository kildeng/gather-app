// Small groups live inside a church. Existing encrypted chats remain independent.
export const ROLES = Object.freeze({ ADMIN: 'ADMIN', PASTOR: 'PASTOR', LEADER: 'LEADER', MEMBER: 'MEMBER' });
export function churchRole(context, claims = {}) {
  if (!context.user || !['member', 'leader'].includes(context.membership?.role)) return null;
  if (context.church?.createdBy === context.user.uid && context.membership.role === 'leader') return ROLES.ADMIN;
  const role = claims.smallGroupRoles?.[context.churchId];
  return ['ADMIN', 'PASTOR'].includes(role) ? role : ROLES.MEMBER;
}
export function groupRole(role, group, uid) {
  if (['ADMIN', 'PASTOR'].includes(role)) return role;
  if (!role || !group?.memberIds.includes(uid)) return null;
  return group.leaderId === uid ? ROLES.LEADER : ROLES.MEMBER;
}
export function validateGroup(data) {
  const limits = { name: 60, description: 500, meetingDay: 12, meetingTime: 5, meetingLocation: 160, imageUrl: 2048 };
  for (const [key, max] of Object.entries(limits)) {
    if (typeof data[key] !== 'string' || data[key].length > max) throw new Error(`Please check ${key}.`);
  }
  if (!data.name.trim()) throw new Error('Please enter a group name.');
  if (!['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(data.meetingDay)) throw new Error('Choose a meeting day.');
  if (data.meetingTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.meetingTime)) throw new Error('Choose a valid meeting time.');
  if (data.imageUrl && !/^https:\/\//i.test(data.imageUrl)) throw new Error('Use an HTTPS image URL.');
  if (!['active', 'archived'].includes(data.status) || !Array.isArray(data.memberIds) || data.memberIds.length > 100 || data.memberIds.some(id => typeof id !== 'string' || !id || id.length > 128) || new Set(data.memberIds).size !== data.memberIds.length || !data.memberIds.includes(data.leaderId)) throw new Error('Select a leader and up to 100 distinct members.');
  return data;
}
export const PRAYER_CATEGORIES = Object.freeze(['Personal', 'Family', 'Health', 'School', 'Work', 'Faith', 'Other']);
export function validatePrayer(data) {
  if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 80) throw new Error('Please add a short title (up to 80 characters).');
  if (typeof data.request !== 'string' || !data.request.trim() || data.request.length > 1000) throw new Error('Please write your prayer request (up to 1000 characters).');
  if (!PRAYER_CATEGORIES.includes(data.category)) throw new Error('Choose a category.');
  if (!['group', 'leaders'].includes(data.privacy)) throw new Error('Choose who can see this request.');
  return data;
}
// Prayer access inside one group: being in the group comes first (an admin who leads a group is its LEADER there).
export function prayerAccess(role, group, uid) {
  if (!role || !group) return null;
  if (group.memberIds?.includes(uid)) return group.leaderId === uid ? 'LEADER' : 'MEMBER';
  return ['ADMIN', 'PASTOR'].includes(role) ? role : null;
}
// Members read prayers with queries the security rules can prove safe: group-wide ones, plus their own.
export function prayerQueries(access) {
  if (access === 'LEADER') return [[]];
  if (access === 'MEMBER') return [[['privacy', '==', 'group']], [['uid', '==', '$me']]];
  if (['ADMIN', 'PASTOR'].includes(access)) return [[['privacy', '==', 'group']]];
  return [];
}
export function createSmallGroupsApi({ F, A, db, auth }) {
  const ref = (cid, ...path) => F.doc(db, 'churches', cid, 'smallGroups', ...path);
  const collection = (cid, ...path) => F.collection(db, 'churches', cid, 'smallGroups', ...path);
  return {
    async claims() { return (await A.getIdTokenResult(auth.currentUser)).claims; },
    watch(cid, role, uid, next, error) {
      const base = collection(cid);
      const q = ['ADMIN', 'PASTOR'].includes(role) ? base : F.query(base, F.where('memberIds', 'array-contains', uid));
      return F.onSnapshot(q, s => next(s.docs.map(d => ({ id: d.id, ...d.data() }))), error);
    },
    watchMembers(cid, gid, next, error) {
      return F.onSnapshot(collection(cid, gid, 'members'), s => next(s.docs.map(d => ({ id: d.id, ...d.data() }))), error);
    },
    // Prayer requests (Phase 2)
    watchPrayers(cid, gid, access, uid, next, error) {
      const qs = prayerQueries(access), results = qs.map(() => []);
      const emit = () => { const all = new Map(); results.flat().forEach(p => all.set(p.id, p)); next([...all.values()]); };
      const stops = qs.map((filters, i) => F.onSnapshot(
        F.query(collection(cid, gid, 'prayers'), ...filters.map(([f, op, v]) => F.where(f, op, v === '$me' ? uid : v))),
        s => { results[i] = s.docs.map(d => ({ id: d.id, ...d.data() })); emit(); }, error));
      if (!qs.length) queueMicrotask(() => next([]));
      return () => stops.forEach(fn => fn());
    },
    async addPrayer(cid, gid, data) {
      validatePrayer(data);
      await F.addDoc(collection(cid, gid, 'prayers'), { uid: auth.currentUser.uid, title: data.title.trim(), request: data.request.trim(), category: data.category, privacy: data.privacy, status: 'active', testimony: '', prayedCount: 0, createdAt: F.serverTimestamp(), answeredAt: null });
    },
    async prayedByMe(cid, gid, pid) { return (await F.getDoc(ref(cid, gid, 'prayers', pid, 'responses', auth.currentUser.uid))).exists(); },
    async pray(cid, gid, pid) {
      const b = F.writeBatch(db);
      b.set(ref(cid, gid, 'prayers', pid, 'responses', auth.currentUser.uid), { createdAt: F.serverTimestamp() });
      b.update(ref(cid, gid, 'prayers', pid), { prayedCount: F.increment(1) });
      await b.commit();
    },
    async answerPrayer(cid, gid, pid, testimony, alreadyAnswered) {
      const t = String(testimony || '').trim().slice(0, 500);
      await F.updateDoc(ref(cid, gid, 'prayers', pid), alreadyAnswered ? { testimony: t } : { status: 'answered', answeredAt: F.serverTimestamp(), testimony: t });
    },
    deletePrayer: (cid, gid, pid) => F.deleteDoc(ref(cid, gid, 'prayers', pid)),
    async save(cid, id, data, role) {
      validateGroup(data);
      const groupRef = id ? ref(cid, id) : F.doc(collection(cid));
      if (role === 'LEADER') {
        const { name, description, meetingDay, meetingTime, meetingLocation, imageUrl } = data;
        await F.updateDoc(groupRef, { name, description, meetingDay, meetingTime, meetingLocation, imageUrl, updatedAt: F.serverTimestamp() });
      } else {
        // All reads precede writes. Membership and projected directory change atomically.
        await F.runTransaction(db, async tx => {
          const old = await tx.get(groupRef);
          const profiles = await Promise.all(data.memberIds.map(uid => tx.get(F.doc(db, 'churches', cid, 'members', uid))));
          if (profiles.some(p => !p.exists() || !['member', 'leader'].includes(p.data().role))) throw new Error('Only approved church members can be assigned.');
          const existingProfiles = old.exists()
            ? await Promise.all(data.memberIds.map(uid => tx.get(ref(cid, groupRef.id, 'members', uid)))) : [];
          const bios = Object.fromEntries(existingProfiles.map(p => [p.id, p.data()?.bio || '']));
          tx.set(groupRef, { ...data, createdAt: old.exists() ? old.data().createdAt : F.serverTimestamp(), updatedAt: F.serverTimestamp() });
          for (const p of profiles) {
            const v = p.data();
            tx.set(ref(cid, groupRef.id, 'members', p.id), { firstName: v.name.trim().split(/\s+/)[0] || 'Member', photo: (/^https:\/\//i.test(v.photo || '') && v.photo.length <= 2048) ? v.photo : '', bio: bios[p.id] || '' });
          }
          for (const uid of old.data()?.memberIds || []) if (!data.memberIds.includes(uid)) tx.delete(ref(cid, groupRef.id, 'members', uid));
        });
      }
      return groupRef.id;
    }
  };
}

// Optional preview data is memory-only and never sent to Firebase.
export function createDemoSmallGroupsApi(getContext) {
  let groups = [{ id: 'faith', name: 'Faith Group', description: 'Know each other. Pray for each other. Grow together.', leaderId: 'me', memberIds: ['me', 'u1', 'u2', 'u3', 'u6'], meetingDay: 'Friday', meetingTime: '19:30', meetingLocation: 'Education Building · Room 2', imageUrl: '', status: 'active' }];
  const byChurch = new Map();
  let seededChurch = null;
  const listFor = cid => {
    if (!seededChurch) { seededChurch = cid; byChurch.set(cid, groups); }
    return byChurch.get(cid) || [];
  };
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const now = Date.now(), day = 864e5, ts = ms => ({ toMillis: () => ms });
  const prayers = { faith: [
    { id: 'p1', uid: 'u1', title: 'School', request: 'Please pray for an important exam this week.', category: 'School', privacy: 'group', status: 'active', testimony: '', prayedCount: 3, createdAt: ts(now - 2 * 3600e3), answeredAt: null },
    { id: 'p2', uid: 'u2', title: 'My grandma', request: 'She is in the hospital. Pray for healing and peace for our family.', category: 'Family', privacy: 'group', status: 'active', testimony: '', prayedCount: 5, createdAt: ts(now - day), answeredAt: null },
    { id: 'p3', uid: 'u3', title: 'Something personal', request: 'I would like my leader to pray with me about a hard week.', category: 'Personal', privacy: 'leaders', status: 'active', testimony: '', prayedCount: 1, createdAt: ts(now - 1.5 * day), answeredAt: null },
    { id: 'p4', uid: 'u6', title: 'Job interview', request: 'Interview on Tuesday for a part-time job.', category: 'Work', privacy: 'group', status: 'answered', testimony: 'I got the job! Thank you all for praying 🙌', prayedCount: 6, createdAt: ts(now - 6 * day), answeredAt: ts(now - 2 * day) }
  ] };
  const prayed = new Set(['p2']);
  const prayerListeners = new Set();
  const emitPrayers = () => prayerListeners.forEach(fn => fn());
  const canSee = (p, access, uid) => access === 'LEADER' || (access === 'MEMBER' && (p.privacy === 'group' || p.uid === uid)) || (['ADMIN', 'PASTOR'].includes(access) && p.privacy === 'group');
  return {
    async claims() { return {}; },
    watchPrayers(cid, gid, access, uid, next) {
      const fn = () => next((prayers[gid] || []).filter(p => canSee(p, access, uid)).map(p => ({ ...p })));
      prayerListeners.add(fn); queueMicrotask(fn); return () => prayerListeners.delete(fn);
    },
    async addPrayer(cid, gid, data) { validatePrayer(data); (prayers[gid] ||= []).push({ id: crypto.randomUUID(), uid: getContext().user.uid, title: data.title.trim(), request: data.request.trim(), category: data.category, privacy: data.privacy, status: 'active', testimony: '', prayedCount: 0, createdAt: ts(Date.now()), answeredAt: null }); emitPrayers(); },
    async prayedByMe(cid, gid, pid) { return prayed.has(pid); },
    async pray(cid, gid, pid) { if (prayed.has(pid)) throw new Error('Already prayed'); prayed.add(pid); const p = prayers[gid].find(x => x.id === pid); p.prayedCount++; emitPrayers(); },
    async answerPrayer(cid, gid, pid, testimony) { const p = prayers[gid].find(x => x.id === pid); Object.assign(p, { status: 'answered', answeredAt: p.answeredAt || ts(Date.now()), testimony: String(testimony || '').trim().slice(0, 500) }); emitPrayers(); },
    async deletePrayer(cid, gid, pid) { prayers[gid] = prayers[gid].filter(x => x.id !== pid); emitPrayers(); },
    watch(cid, role, uid, next) {
      const fn = () => next(listFor(cid).filter(g => ['ADMIN', 'PASTOR'].includes(role) || g.memberIds.includes(uid)).map(g => ({ ...g })));
      listeners.add(fn); queueMicrotask(fn); return () => listeners.delete(fn);
    },
    watchMembers(cid, gid, next) {
      const g = listFor(cid).find(g => g.id === gid), c = getContext();
      queueMicrotask(() => next((g?.memberIds || []).map(id => ({ id, firstName: c.members[id]?.name.split(' ')[0] || 'Member', photo: c.members[id]?.photo || '', bio: '' }))));
      return () => {};
    },
    async save(cid, id, data, role) {
      const c = getContext(), ownRole = churchRole(c), old = listFor(cid).find(g => g.id === id);
      if (ownRole !== 'ADMIN' && groupRole(ownRole, old, c.user.uid) !== 'LEADER') throw new Error('Not authorized.');
      validateGroup(data);
      if (role === 'LEADER') data = { ...old, ...Object.fromEntries(['name', 'description', 'meetingDay', 'meetingTime', 'meetingLocation', 'imageUrl'].map(k => [k, data[k]])) };
      const gid = id || crypto.randomUUID(); byChurch.set(cid, [...listFor(cid).filter(g => g.id !== gid), { ...data, id: gid }]); emit(); return gid;
    }
  };
}

const ms = t => t?.toMillis ? t.toMillis() : (typeof t === 'number' ? t : Date.now());
const when = t => { const d = ms(t), diff = Date.now() - d; if (diff < 6e4) return 'Just now'; if (diff < 36e5) return Math.floor(diff / 6e4) + 'm ago'; if (diff < 864e5) return Math.floor(diff / 36e5) + 'h ago'; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const image = url => /^https:\/\//i.test(url || '') ? escape(url) : '';
export function createSmallGroupsUI({ root, getContext, getApi, sheet, toast, changed }) {
  let context = null, role = null, groups = [], selected = null, page = 'home', profiles = [], error = '', loading = true;
  let stop = null, stopMembers = null, stopPrayers = null, generation = 0, signature = '', dialog = null;
  let prayers = [], prayersLoaded = false, prayedSet = new Set(), prayerFilter = 'active';
  const current = () => groups.find(g => g.id === selected);
  const permitted = () => groupRole(role, current(), context?.user?.uid);
  function reset() {
    dialog?.remove(); dialog = null;
    generation++; stop?.(); stopMembers?.(); stopPrayers?.(); stop = stopMembers = stopPrayers = null;
    signature = ''; context = null; role = null; groups = []; selected = null; profiles = []; loading = true; error = ''; page = 'home';
    prayers = []; prayersLoaded = false; prayedSet = new Set();
    root.replaceChildren(); changed?.();
  }
  function select(id) {
    const same = id === selected && stopPrayers;
    stopMembers?.(); stopMembers = null; profiles = []; selected = id;
    const epoch = generation, gid = id;
    if (!same){
      stopPrayers?.(); stopPrayers = null; prayers = []; prayersLoaded = false; prayedSet = new Set();
      const access = prayerAccess(role, groups.find(g => g.id === id), context?.user?.uid);
      if (id && access) stopPrayers = getApi().watchPrayers(context.churchId, id, access, context.user.uid, list => {
        if (epoch !== generation || selected !== gid) return;
        prayers = list.sort((a, b) => ms(b.createdAt) - ms(a.createdAt)); prayersLoaded = true;
        list.filter(p => !prayedSet.has(p.id)).forEach(p => getApi().prayedByMe(context.churchId, gid, p.id).then(yes => { if (yes && selected === gid){ prayedSet.add(p.id); render(); } }).catch(() => {}));
        render(); changed?.();
      }, () => { if (epoch === generation && selected === gid){ prayers = []; prayersLoaded = true; render(); } });
    }
    if (id) stopMembers = getApi().watchMembers(context.churchId, id, list => {
      if (epoch !== generation || selected !== gid) return;
      profiles = list; render();
    }, () => { if (epoch === generation && selected === gid) { profiles = []; error = 'Could not load the group directory. Check access and try again.'; render(); } });
  }
  async function sync() {
    const c = getContext();
    if (!c.user || !c.church || !['member', 'leader'].includes(c.membership?.role)) { reset(); return; }
    const key = `${c.churchId}:${c.user.uid}:${c.membership.role}:${c.church.createdBy}`;
    context = c;
    if (signature === key) { render(); return; }
    reset(); context = c; signature = key;
    const epoch = generation;
    try {
      const claims = await getApi().claims();
      if (epoch !== generation) return;
      role = churchRole(c, claims);
      stop = getApi().watch(c.churchId, role, c.user.uid, list => {
        if (epoch !== generation) return;
        groups = list.sort((a, b) => a.name.localeCompare(b.name)); loading = false; error = '';
        if (!groups.some(g => g.id === selected)) select(groups.find(g => g.status === 'active')?.id || groups[0]?.id || null);
        else select(selected); // refresh directory after an assignment changes
        render(); changed?.();
      }, () => {
        if (epoch !== generation) return;
        stopMembers?.(); stopMembers = null; groups = []; profiles = []; selected = null; loading = false;
        error = 'Small Groups could not load. Ask your administrator to publish the updated Firestore rules, then retry.'; render(); changed?.();
      });
    } catch {
      if (epoch !== generation) return;
      loading = false; error = 'Could not verify your access. Please retry.'; render();
    }
    render();
  }
  function render() {
    const g = current(), access = permitted();
    root.innerHTML = `<div class="sg-intro"><span class="sg-eyebrow">Life together</span><h2>Small Groups</h2><p>Know each other. Care for each other. Grow together.</p></div>`;
    if (loading) { root.insertAdjacentHTML('beforeend', '<p role="status">Loading your groups…</p>'); return; }
    if (error) { root.insertAdjacentHTML('beforeend', `<div class="sg-card" role="alert"><p>${escape(error)}</p><button class="btn secondary" data-sg="retry">Retry</button></div>`); return; }
    root.insertAdjacentHTML('beforeend', `<div class="sg-controls">${groups.length ? `<label>Your groups<select id="sgSelect">${groups.map(x => `<option value="${escape(x.id)}" ${x.id === selected ? 'selected' : ''}>${escape(x.name)}${x.status === 'archived' ? ' (archived)' : ''}</option>`).join('')}</select></label>` : ''}<div class="sg-nav"><button data-sg="home" class="${page === 'home' ? 'on' : ''}">My Group</button><button data-sg="prayer" class="${page === 'prayer' ? 'on' : ''}">Prayer</button><button data-sg="members" class="${page === 'members' ? 'on' : ''}">Members</button>${['ADMIN', 'PASTOR'].includes(role) ? `<button data-sg="admin" class="${page === 'admin' ? 'on' : ''}">${role === 'ADMIN' ? 'Small Groups Admin' : 'All Groups'}</button>` : ''}</div></div>`);
    if (page === 'admin' && ['ADMIN', 'PASTOR'].includes(role)) {
      root.insertAdjacentHTML('beforeend', `${role === 'ADMIN' ? '<button class="compose-btn" data-sg="create">＋ Create Group</button>' : ''}${groups.map(x => `<article class="sg-card"><span class="sg-eyebrow">${escape(x.status)}</span><h3>${escape(x.name)}</h3><p>${x.memberIds.length} members · ${escape(x.meetingDay || 'Schedule to come')} ${escape(x.meetingTime)}</p><div class="sg-actions"><button class="btn secondary" data-sg="view" data-id="${escape(x.id)}">View Group</button>${role === 'ADMIN' ? `<button class="btn secondary" data-sg="edit" data-id="${escape(x.id)}">Edit & assign members</button>` : ''}</div></article>`).join('') || '<div class="empty">No small groups yet.</div>'}`);
      return;
    }
    if (!g || !access) {
      root.insertAdjacentHTML('beforeend', `<div class="sg-card"><h3>A place to belong</h3><p>You haven’t been assigned to a small group yet. Ask your church administrator to help you find one.</p>${role === 'ADMIN' ? '<button class="btn" data-sg="create">Create Group</button>' : ''}</div>`); return;
    }
    if (page === 'members') {
      root.insertAdjacentHTML('beforeend', `<h3>${escape(g.name)} · Members</h3><p class="sg-muted">Only names and optional profile details are shown.</p><div class="sg-directory">${profiles.filter(p => g.memberIds.includes(p.id)).map(p => `<article class="sg-member"><div class="avatar">${image(p.photo) ? `<img src="${image(p.photo)}" alt="" referrerpolicy="no-referrer">` : escape(p.firstName.slice(0, 1))}</div><div><h3>${escape(p.firstName)}</h3><span class="sg-muted">${p.id === g.leaderId ? 'Leader' : 'Member'}</span>${p.bio ? `<p>${escape(p.bio)}</p>` : ''}</div></article>`).join('') || '<p role="status">Loading members…</p>'}</div>`); return;
    }
    if (page === 'prayer') { root.insertAdjacentHTML('beforeend', prayerPage(g, prayerAccess(role, g, context.user.uid))); return; }
    const leader = profiles.find(p => p.id === g.leaderId)?.firstName || 'Group Leader';
    root.insertAdjacentHTML('beforeend', `<article class="sg-card sg-hero">${image(g.imageUrl) ? `<img class="sg-cover" src="${image(g.imageUrl)}" alt="${escape(g.name)}" referrerpolicy="no-referrer">` : '<div class="sg-symbol" aria-hidden="true">🌱</div>'}<span class="sg-eyebrow">${g.status === 'archived' ? 'Archived group' : 'Your Small Group'}</span><h2>${escape(g.name)}</h2><p>${escape(g.description)}</p><dl class="sg-details"><div><dt>Leader</dt><dd>${escape(leader)}</dd></div><div><dt>Members</dt><dd>${g.memberIds.length}</dd></div><div><dt>Meeting schedule</dt><dd>${escape(g.meetingDay || 'To be announced')} ${escape(g.meetingTime)}</dd></div><div><dt>Location</dt><dd>${escape(g.meetingLocation || 'To be announced')}</dd></div></dl><div class="sg-actions"><button class="btn" data-sg="members">Meet your group</button>${['ADMIN', 'LEADER'].includes(access) ? `<button class="btn secondary" data-sg="edit" data-id="${escape(g.id)}">Edit group details</button>` : ''}</div></article>${quickActions(g)}${activity()}`);
  }
  const nameOf = uid => profiles.find(p => p.id === uid)?.firstName || 'A member';
  function quickActions(g) {
    const active = prayers.filter(p => p.status === 'active').length;
    return `<div class="sg-quick"><button data-sg="prayer"><span>🙏</span><b>Prayer</b><small>${active ? `${active} active request${active > 1 ? 's' : ''}` : 'Share a request'}</small></button><button data-sg="members"><span>👋</span><b>Members</b><small>${g.memberIds.length} people</small></button><button disabled><span>💬</span><b>Discussion</b><small>Coming soon</small></button><button disabled><span>📅</span><b>Next Meeting</b><small>${escape(g.meetingDay ? `${g.meetingDay} ${g.meetingTime}` : 'Coming soon')}</small></button></div>`;
  }
  function activity() {
    const items = [];
    for (const p of prayers) {
      items.push({ at: ms(p.createdAt), text: `${escape(nameOf(p.uid))} shared a prayer request${p.privacy === 'leaders' ? ' with leaders' : ''}.` });
      if (p.status === 'answered') items.push({ at: ms(p.answeredAt), text: `${escape(nameOf(p.uid))}'s prayer was answered 🎉` });
    }
    items.sort((a, b) => b.at - a.at);
    return `<article class="sg-card"><h3>Recent activity</h3>${items.length ? `<ul class="sg-activity">${items.slice(0, 6).map(i => `<li><span>${i.text}</span><small>${when(i.at)}</small></li>`).join('')}</ul>` : `<p>Nothing new yet. Share a prayer request to get started.</p>`}</article>`;
  }
  const seenKey = () => `sgPrayerSeen:${context?.churchId}:${selected}`;
  const seenAt = () => { try { return Number(localStorage.getItem(seenKey())) || Date.now() - 7 * 864e5; } catch { return Date.now() - 7 * 864e5; } };
  function prayerPage(g, access) {
    try { localStorage.setItem(seenKey(), String(Date.now())); } catch {}
    const isLeader = access === 'LEADER', me = context.user.uid;
    const list = prayers.filter(p => p.status === prayerFilter);
    const counts = { active: prayers.filter(p => p.status === 'active').length, answered: prayers.filter(p => p.status === 'answered').length };
    const card = p => {
      const mine = p.uid === me, canAnswer = mine || isLeader, did = prayedSet.has(p.id);
      return `<article class="sg-card sg-prayer ${p.status === 'answered' ? 'answered' : ''}">
        <div class="sg-prayer-top"><span class="sg-chip">${escape(p.category)}</span>${p.privacy === 'leaders' ? '<span class="sg-chip lock">🔒 Leaders only</span>' : ''}<span class="sg-chip ${p.status === 'answered' ? 'ok' : ''}">${p.status === 'answered' ? 'Answered' : 'Active'}</span></div>
        <h3>${escape(p.title)}</h3><p>${escape(p.request)}</p>
        ${p.status === 'answered' && p.testimony ? `<div class="sg-testimony"><b>Testimony</b><p>${escape(p.testimony)}</p></div>` : ''}
        <div class="sg-prayer-meta">${escape(mine ? 'You' : nameOf(p.uid))} · ${when(p.createdAt)} · 🙏 ${p.prayedCount} ${p.prayedCount === 1 ? 'person' : 'people'} praying</div>
        <div class="sg-actions">${p.status === 'active' ? `<button class="btn ${did ? 'secondary' : ''}" data-sg="pray" data-id="${escape(p.id)}" ${did ? 'disabled' : ''}>${did ? '✓ You prayed' : '🙏 I Prayed'}</button>` : ''}
          ${canAnswer ? `<button class="btn secondary" data-sg="answer" data-id="${escape(p.id)}">${p.status === 'answered' ? (p.testimony ? 'Edit testimony' : 'Add testimony') : 'Mark as answered'}</button>` : ''}
          ${canAnswer ? `<button class="link-btn danger" data-sg="delprayer" data-id="${escape(p.id)}">Delete</button>` : ''}</div>
      </article>`;
    };
    const canPost = g.memberIds.includes(me) && g.status === 'active';
    return `${canPost ? '<button class="compose-btn" data-sg="newprayer">＋ Share a prayer request</button>' : `<p class="sg-muted">${g.status !== 'active' ? 'This group is archived.' : 'You can read group-wide requests. Only group members can share new ones.'}</p>`}
      <div class="sg-nav sg-sub"><button data-sg="pf-active" class="${prayerFilter === 'active' ? 'on' : ''}">Active · ${counts.active}</button><button data-sg="pf-answered" class="${prayerFilter === 'answered' ? 'on' : ''}">Answered · ${counts.answered}</button></div>
      ${!prayersLoaded ? '<p role="status">Loading prayer requests…</p>' : list.length ? list.map(card).join('') : `<div class="empty">${prayerFilter === 'active' ? 'No prayer requests right now. Be the first to share one.' : 'No answered prayers yet.'}</div>`}
      <p class="sg-muted">“Leaders only” requests are visible only to you and your group leader. Prayer requests are protected so only your group can see them, but please don’t share anything you wouldn’t say in your group.</p>`;
  }
  function newPrayer() {
    const g = current(); if (!g) return; const epoch = generation, gid = g.id;
    dialog?.remove();
    const bg = sheet(`<form class="sg-form scroll"><h2>Share a prayer request</h2>
      <label>Title<input name="title" maxlength="80" required placeholder="e.g. School"></label>
      <label>Prayer request<textarea name="request" maxlength="1000" required placeholder="What can your group pray for?"></textarea></label>
      <label>Category<select name="category">${PRAYER_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></label>
      <fieldset><legend>Who can see this?</legend>
        <label class="sg-check"><input type="radio" name="privacy" value="group" checked> <span><b>My group</b><br><small class="sg-muted">Everyone in ${escape(g.name)}</small></span></label>
        <label class="sg-check"><input type="radio" name="privacy" value="leaders"> <span><b>Leaders only</b><br><small class="sg-muted">Only your group leader</small></span></label></fieldset>
      <p class="sg-error" role="alert"></p>
      <div class="sg-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">Share</button></div></form>`);
    dialog = bg;
    bg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget), btn = e.currentTarget.querySelector('[type=submit]');
      const data = { title: String(f.get('title') || '').trim(), request: String(f.get('request') || '').trim(), category: f.get('category'), privacy: f.get('privacy') };
      btn.disabled = true;
      try { validatePrayer(data); await getApi().addPrayer(context.churchId, gid, data); if (epoch !== generation) return; bg.remove(); prayerFilter = 'active'; render(); toast('Prayer request shared'); }
      catch (err) { bg.querySelector('.sg-error').textContent = err.code === 'permission-denied' ? 'You do not have permission, or the updated Firestore rules are not published.' : err.message || 'Could not share. Please try again.'; btn.disabled = false; }
    });
  }
  async function pray(pid) {
    if (prayedSet.has(pid)) return;
    prayedSet.add(pid); render();
    try { await getApi().pray(context.churchId, selected, pid); toast('Thank you for praying 🙏'); }
    catch (err) { const yes = await getApi().prayedByMe(context.churchId, selected, pid).catch(() => false); if (!yes) prayedSet.delete(pid); render(); if (!yes) toast('Could not save. Please try again.'); }
  }
  function answer(pid) {
    const p = prayers.find(x => x.id === pid); if (!p) return;
    const was = p.status === 'answered';
    dialog?.remove();
    const bg = sheet(`<form class="sg-form scroll"><h2>${was ? 'Testimony' : 'Answered prayer 🎉'}</h2><p class="sg-muted">${escape(p.title)}</p>
      <label>Share how God answered (optional)<textarea name="t" maxlength="500" placeholder="A short testimony for your group">${escape(p.testimony)}</textarea></label>
      <p class="sg-error" role="alert"></p>
      <div class="sg-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">${was ? 'Save' : 'Mark as answered'}</button></div></form>`);
    dialog = bg;
    bg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.currentTarget.querySelector('[type=submit]'); btn.disabled = true;
      try { await getApi().answerPrayer(context.churchId, selected, pid, new FormData(e.currentTarget).get('t'), was); bg.remove(); if (!was){ prayerFilter = 'answered'; render(); } toast(was ? 'Saved' : 'Praise God! Marked as answered'); }
      catch (err) { bg.querySelector('.sg-error').textContent = err.message || 'Could not save.'; btn.disabled = false; }
    });
  }
  async function deletePrayer(pid) {
    const bg = sheet(`<p style="font-weight:600">Delete this prayer request? This can't be undone.</p><div class="sg-actions"><button class="btn secondary" data-close>Cancel</button><button class="btn" data-yes style="background:var(--danger);color:#fff">Delete</button></div>`);
    bg.querySelector('[data-yes]').addEventListener('click', async () => { bg.remove(); try { await getApi().deletePrayer(context.churchId, selected, pid); toast('Deleted'); } catch { toast('Could not delete.'); } });
  }
  function edit(id) {
    const c = getContext(), g = groups.find(x => x.id === id), access = groupRole(role, g, c.user.uid);
    if (role !== 'ADMIN' && access !== 'LEADER') return;
    const admin = role === 'ADMIN', epoch = generation;
    const members = Object.entries(c.members).filter(([, m]) => ['member', 'leader'].includes(m.role));
    const value = key => escape(g?.[key] || '');
    const input = (label, key, max, type = 'text') => `<label>${label}<input name="${key}" type="${type}" maxlength="${max}" value="${value(key)}" ${key === 'name' ? 'required' : ''}></label>`;
    dialog?.remove();
    const bg = sheet(`<form id="sgForm" class="sg-form scroll"><h2>${g ? 'Edit Group' : 'Create Group'}</h2>${input('Group Name', 'name', 60)}<label>Description<textarea name="description" maxlength="500">${value('description')}</textarea></label><label>Meeting Day<select name="meetingDay">${['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => `<option ${g?.meetingDay === day ? 'selected' : ''}>${day}</option>`).join('')}</select></label>${input('Meeting Time', 'meetingTime', 5, 'time')}${input('Meeting Location', 'meetingLocation', 160)}${input('Group Image (HTTPS URL, optional)', 'imageUrl', 2048, 'url')}${admin ? `<label>Leader<select name="leaderId" required><option value="">Choose a leader</option>${members.map(([uid, m]) => `<option value="${escape(uid)}" ${g?.leaderId === uid ? 'selected' : ''}>${escape(m.name)}</option>`).join('')}</select></label><fieldset><legend>Members · leader is included automatically</legend>${members.map(([uid, m]) => `<label class="sg-check"><input type="checkbox" name="memberIds" value="${escape(uid)}" ${g?.memberIds.includes(uid) ? 'checked' : ''}>${escape(m.name)}</label>`).join('')}</fieldset><label>Status<select name="status"><option value="active">Active</option><option value="archived" ${g?.status === 'archived' ? 'selected' : ''}>Archived</option></select></label>` : ''}<p class="sg-muted">Group details are visible to assigned members and authorized church staff. Don’t include private care notes.</p><p class="sg-error" role="alert"></p><div class="sg-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="submit" class="btn">Save Group</button></div></form>`);
    dialog = bg;
    bg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault(); const form = e.currentTarget, button = form.querySelector('[type="submit"]');
      if (epoch !== generation) { bg.remove(); return; }
      const fields = new FormData(form), data = Object.fromEntries(['name', 'description', 'meetingDay', 'meetingTime', 'meetingLocation', 'imageUrl'].map(k => [k, String(fields.get(k) || '').trim()]));
      Object.assign(data, admin ? { leaderId: fields.get('leaderId'), memberIds: [...new Set([...fields.getAll('memberIds'), fields.get('leaderId')])], status: fields.get('status') } : { leaderId: g.leaderId, memberIds: g.memberIds, status: g.status });
      button.disabled = true;
      try {
        const saved = await getApi().save(c.churchId, id, data, admin ? 'ADMIN' : 'LEADER');
        if (epoch !== generation) return;
        select(saved); page = 'home'; render(); bg.remove(); toast('Group saved');
      } catch (err) { form.querySelector('.sg-error').textContent = err.code === 'permission-denied' ? 'You do not have permission, or the updated Firestore rules are not published.' : err.message || 'Could not save. Please try again.'; }
      finally { button.disabled = false; }
    });
  }
  root.addEventListener('change', e => { if (e.target.id === 'sgSelect') { select(e.target.value); page = 'home'; render(); } });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-sg]'); if (!b) return;
    const action = b.dataset.sg;
    if (action === 'retry') { signature = ''; sync(); }
    else if (action === 'create' || action === 'edit') edit(b.dataset.id);
    else if (action === 'view') { select(b.dataset.id); page = 'home'; render(); }
    else if (['home', 'members', 'admin', 'prayer'].includes(action)) { page = action; render(); }
    else if (action === 'newprayer') newPrayer();
    else if (action === 'pray') pray(b.dataset.id);
    else if (action === 'answer') answer(b.dataset.id);
    else if (action === 'delprayer') deletePrayer(b.dataset.id);
    else if (action === 'pf-active' || action === 'pf-answered') { prayerFilter = action.slice(3); render(); }
  });
  return { sync, reset, render,
    summary() { return groups.find(g => g.status === 'active' && g.memberIds.includes(context?.user?.uid)); },
    // for the News home card: counts only, never prayer content
    newPrayerCount() { const since = seenAt(); return prayers.filter(p => p.status === 'active' && p.uid !== context?.user?.uid && ms(p.createdAt) > since).length; } };
}
