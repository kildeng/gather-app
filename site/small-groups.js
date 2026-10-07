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
  return {
    async claims() { return {}; },
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

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const image = url => /^https:\/\//i.test(url || '') ? escape(url) : '';
export function createSmallGroupsUI({ root, getContext, getApi, sheet, toast, changed }) {
  let context = null, role = null, groups = [], selected = null, page = 'home', profiles = [], error = '', loading = true;
  let stop = null, stopMembers = null, generation = 0, signature = '', dialog = null;
  const current = () => groups.find(g => g.id === selected);
  const permitted = () => groupRole(role, current(), context?.user?.uid);
  function reset() {
    dialog?.remove(); dialog = null;
    generation++; stop?.(); stopMembers?.(); stop = stopMembers = null;
    signature = ''; context = null; role = null; groups = []; selected = null; profiles = []; loading = true; error = ''; page = 'home';
    root.replaceChildren(); changed?.();
  }
  function select(id) {
    stopMembers?.(); stopMembers = null; profiles = []; selected = id;
    const epoch = generation, gid = id;
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
    root.insertAdjacentHTML('beforeend', `<div class="sg-controls">${groups.length ? `<label>Your groups<select id="sgSelect">${groups.map(x => `<option value="${escape(x.id)}" ${x.id === selected ? 'selected' : ''}>${escape(x.name)}${x.status === 'archived' ? ' (archived)' : ''}</option>`).join('')}</select></label>` : ''}<div class="sg-nav"><button data-sg="home" class="${page === 'home' ? 'on' : ''}">My Group</button><button data-sg="members" class="${page === 'members' ? 'on' : ''}">Members</button>${['ADMIN', 'PASTOR'].includes(role) ? `<button data-sg="admin" class="${page === 'admin' ? 'on' : ''}">${role === 'ADMIN' ? 'Small Groups Admin' : 'All Groups'}</button>` : ''}</div></div>`);
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
    const leader = profiles.find(p => p.id === g.leaderId)?.firstName || 'Group Leader';
    root.insertAdjacentHTML('beforeend', `<article class="sg-card sg-hero">${image(g.imageUrl) ? `<img class="sg-cover" src="${image(g.imageUrl)}" alt="${escape(g.name)}" referrerpolicy="no-referrer">` : '<div class="sg-symbol" aria-hidden="true">🌱</div>'}<span class="sg-eyebrow">${g.status === 'archived' ? 'Archived group' : 'Your Small Group'}</span><h2>${escape(g.name)}</h2><p>${escape(g.description)}</p><dl class="sg-details"><div><dt>Leader</dt><dd>${escape(leader)}</dd></div><div><dt>Members</dt><dd>${g.memberIds.length}</dd></div><div><dt>Meeting schedule</dt><dd>${escape(g.meetingDay || 'To be announced')} ${escape(g.meetingTime)}</dd></div><div><dt>Location</dt><dd>${escape(g.meetingLocation || 'To be announced')}</dd></div></dl><div class="sg-actions"><button class="btn" data-sg="members">Meet your group</button>${['ADMIN', 'LEADER'].includes(access) ? `<button class="btn secondary" data-sg="edit" data-id="${escape(g.id)}">Edit group details</button>` : ''}</div></article><article class="sg-card"><h3>Growing together</h3><p>Your group’s home and directory are ready. Prayer, meetings and weekly discussion will be added in the next stages.</p></article>`);
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
    else if (['home', 'members', 'admin'].includes(action)) { page = action; render(); }
  });
  return { sync, reset, render, summary() { return groups.find(g => g.status === 'active' && g.memberIds.includes(context?.user?.uid)); } };
}
