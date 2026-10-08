// Security-rule tests for the Small Group space (events + RSVP + prayer). Emulator only (demo-gather).
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp, increment, deleteField } from 'firebase/firestore';

let env;
const cid = 'church', other = 'otherChurch';
const db = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const ev = id => `churches/${cid}/events/${id}`;
const pr = id => `churches/${cid}/prayers/${id}`;
const box = { iv: 'aXY=', ct: 'ZW5jcnlwdGVk' };   // stands in for end-to-end encrypted content
const newEvent = (uid, patch = {}) => ({ uid, startAt: Timestamp.fromMillis(Date.now() + 864e5), ...box, rsvp: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...patch });
const newPrayer = (uid, privacy = 'group', patch = {}) => ({ uid, anon: false, privacy, status: 'active', prayedCount: 0, ...box, createdAt: serverTimestamp(), answeredAt: null, ...patch });
const pray = async (uid, id) => { const f = db(uid), b = writeBatch(f); b.set(doc(f, pr(id) + '/responses/' + uid), { createdAt: serverTimestamp() }); b.update(doc(f, pr(id)), { prayedCount: increment(1) }); return b.commit(); };

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-gather', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firebase/firestore.rules', import.meta.url), 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    await setDoc(doc(f, `churches/${cid}`), { name: 'FGYG', createdBy: 'leader' });
    await setDoc(doc(f, `churches/${other}`), { name: 'Other', createdBy: 'otherLeader' });
    const roles = { leader: 'leader', leader2: 'leader', member: 'member', member2: 'member', pending: 'pending', removed: 'removed' };
    for (const [uid, role] of Object.entries(roles)) await setDoc(doc(f, `churches/${cid}/members/${uid}`), { name: uid, role });
    await setDoc(doc(f, `churches/${other}/members/otherLeader`), { name: 'otherLeader', role: 'leader' });
    await setDoc(doc(f, ev('e1')), { uid: 'leader', startAt: Timestamp.fromMillis(Date.now() + 864e5), ...box, rsvp: { member2: 'maybe' }, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    const seed = (uid, privacy) => ({ uid, anon: false, privacy, status: 'active', prayedCount: 0, ...box, createdAt: Timestamp.now(), answeredAt: null });
    await setDoc(doc(f, pr('open')), seed('member', 'group'));
    await setDoc(doc(f, pr('private')), seed('member', 'leaders'));
    await setDoc(doc(f, `churches/${other}/prayers/x`), seed('otherLeader', 'group'));
  });
});
after(async () => { await env?.cleanup(); });

test('only approved members of this group can see its events', async () => {
  await assertSucceeds(getDoc(doc(db('member'), ev('e1'))));
  await assertSucceeds(getDocs(collection(db('member'), `churches/${cid}/events`)));
  for (const uid of ['pending', 'removed', 'otherLeader', 'stranger']) await assertFails(getDoc(doc(db(uid), ev('e1'))));
  await assertFails(getDoc(doc(anon(), ev('e1'))));
  await assertFails(getDocs(collection(db('member'), `churches/${other}/events`)));
});
test('leaders post, edit and delete events; members cannot', async () => {
  await assertSucceeds(setDoc(doc(db('leader'), ev('e2')), newEvent('leader')));
  await assertFails(setDoc(doc(db('member'), ev('e3')), newEvent('member')));
  await assertFails(setDoc(doc(db('leader'), ev('e4')), newEvent('leader2')));                          // posting as someone else
  await assertFails(setDoc(doc(db('leader'), ev('e5')), newEvent('leader', { rsvp: { member: 'going' } }))); // pre-filled answers
  await assertFails(setDoc(doc(db('leader'), ev('e6')), newEvent('leader', { title: 'plain text' })));     // unexpected plaintext field
  await assertFails(setDoc(doc(db('otherLeader'), ev('e7')), newEvent('otherLeader')));                   // leader of another group
  await assertSucceeds(updateDoc(doc(db('leader2'), ev('e2')), { ...box, startAt: Timestamp.fromMillis(Date.now() + 2 * 864e5), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('member'), ev('e2')), { ...box, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db('member'), ev('e2'))));
  await assertSucceeds(deleteDoc(doc(db('leader'), ev('e2'))));
});
test('RSVP: everyone answers only for themselves, with Going / Maybe / Can\'t go', async () => {
  await assertSucceeds(updateDoc(doc(db('member'), ev('e1')), { 'rsvp.member': 'going' }));
  await assertSucceeds(updateDoc(doc(db('member'), ev('e1')), { 'rsvp.member': 'no' }));
  await assertSucceeds(updateDoc(doc(db('member'), ev('e1')), { 'rsvp.member': deleteField() }));
  await assertSucceeds(updateDoc(doc(db('leader'), ev('e1')), { 'rsvp.leader': 'maybe' }));
  await assertFails(updateDoc(doc(db('member'), ev('e1')), { 'rsvp.member2': 'no' }));                     // someone else's answer
  await assertFails(updateDoc(doc(db('member'), ev('e1')), { 'rsvp.member2': deleteField() }));
  await assertFails(updateDoc(doc(db('member'), ev('e1')), { 'rsvp.member': 'definitely' }));
  await assertFails(updateDoc(doc(db('member'), ev('e1')), { 'rsvp.member': 'going', 'rsvp.member2': 'going' }));
  await assertFails(updateDoc(doc(db('pending'), ev('e1')), { 'rsvp.pending': 'going' }));
  await assertFails(updateDoc(doc(db('otherLeader'), ev('e1')), { 'rsvp.otherLeader': 'going' }));
  const snap = await getDoc(doc(db('member2'), ev('e1')));
  if (snap.data().rsvp.member2 !== 'maybe' || snap.data().rsvp.leader !== 'maybe') throw new Error('unexpected rsvp ' + JSON.stringify(snap.data().rsvp));
});
test('"Leaders Only" prayers are returned only to the author and the group\'s leaders', async () => {
  await assertSucceeds(getDoc(doc(db('member'), pr('private'))));
  await assertSucceeds(getDoc(doc(db('leader'), pr('private'))));
  await assertSucceeds(getDoc(doc(db('leader2'), pr('private'))));
  for (const uid of ['member2', 'pending', 'removed', 'otherLeader', 'stranger']) await assertFails(getDoc(doc(db(uid), pr('private'))));
  await assertFails(getDocs(collection(db('member2'), `churches/${cid}/prayers`)));                         // a plain list would include it
  const open = await assertSucceeds(getDocs(query(collection(db('member2'), `churches/${cid}/prayers`), where('privacy', '==', 'group'))));
  if (open.docs.some(d => d.data().privacy !== 'group')) throw new Error('leaders-only prayer leaked');
  await assertSucceeds(getDocs(query(collection(db('member2'), `churches/${cid}/prayers`), where('uid', '==', 'member2'))));
  await assertSucceeds(getDocs(collection(db('leader'), `churches/${cid}/prayers`)));
});
test('group prayers: visible to this group only', async () => {
  await assertSucceeds(getDoc(doc(db('member2'), pr('open'))));
  await assertFails(getDoc(doc(db('member'), `churches/${other}/prayers/x`)));
  for (const uid of ['pending', 'removed', 'otherLeader']) await assertFails(getDoc(doc(db(uid), pr('open'))));
  await assertFails(getDoc(doc(anon(), pr('open'))));
});
test('prayer request creation works for members, with valid fields only', async () => {
  await assertSucceeds(setDoc(doc(db('member2'), pr('p1')), newPrayer('member2')));
  await assertSucceeds(setDoc(doc(db('member2'), pr('p2')), newPrayer('member2', 'leaders')));
  await assertFails(setDoc(doc(db('member2'), pr('p3')), newPrayer('member')));
  await assertFails(setDoc(doc(db('member2'), pr('p4')), newPrayer('member2', 'public')));
  await assertFails(setDoc(doc(db('member2'), pr('p5')), newPrayer('member2', 'group', { prayedCount: 50 })));
  await assertFails(setDoc(doc(db('member2'), pr('p6')), newPrayer('member2', 'group', { status: 'answered' })));
  await assertFails(setDoc(doc(db('member2'), pr('p7')), newPrayer('member2', 'group', { request: 'plain text' })));
  await assertFails(setDoc(doc(db('pending'), pr('p8')), newPrayer('pending')));
  await assertFails(setDoc(doc(db('otherLeader'), pr('p9')), newPrayer('otherLeader')));
});
test('"I Prayed" counts once per person and cannot be forged', async () => {
  await assertSucceeds(pray('member2', 'open'));
  await assertFails(pray('member2', 'open'));                                                               // duplicate
  await assertSucceeds(pray('leader', 'open'));
  await assertFails(updateDoc(doc(db('member'), pr('open')), { prayedCount: increment(1) }));               // count without a record
  await assertFails(setDoc(doc(db('member'), pr('open') + '/responses/member'), { createdAt: serverTimestamp() }));
  { const f = db('member'), b = writeBatch(f); b.set(doc(f, pr('open') + '/responses/member'), { createdAt: serverTimestamp() }); b.update(doc(f, pr('open')), { prayedCount: increment(5) }); await assertFails(b.commit()); }
  { const f = db('member'), b = writeBatch(f); b.set(doc(f, pr('open') + '/responses/member2'), { createdAt: serverTimestamp() }); b.update(doc(f, pr('open')), { prayedCount: increment(1) }); await assertFails(b.commit()); }
  await assertFails(deleteDoc(doc(db('member2'), pr('open') + '/responses/member2')));
  await assertFails(getDoc(doc(db('member'), pr('open') + '/responses/member2')));                           // who prayed stays private
  await assertFails(pray('member2', 'private'));                                                            // can't pray on what you can't see
  const snap = await getDoc(doc(db('member'), pr('open')));
  if (snap.data().prayedCount !== 2) throw new Error('expected 2, got ' + snap.data().prayedCount);
});
test('only the author or a leader can mark a prayer answered or change it', async () => {
  await assertFails(updateDoc(doc(db('member2'), pr('open')), { status: 'answered', answeredAt: serverTimestamp(), ...box }));
  await assertSucceeds(updateDoc(doc(db('member'), pr('open')), { status: 'answered', answeredAt: serverTimestamp(), iv: 'bmV3', ct: 'dGVzdGltb255' }));
  await assertSucceeds(updateDoc(doc(db('member'), pr('open')), { iv: 'bmV3Mg==', ct: 'dGVzdGltb255Mg==' }));
  await assertFails(updateDoc(doc(db('member'), pr('open')), { status: 'active' }));
  await assertSucceeds(updateDoc(doc(db('leader'), pr('private')), { status: 'answered', answeredAt: serverTimestamp(), ...box }));
  await assertFails(updateDoc(doc(db('member2'), pr('p1')), { privacy: 'leaders' }));
  await assertFails(deleteDoc(doc(db('member2'), pr('open'))));
  await assertSucceeds(deleteDoc(doc(db('member2'), pr('p1'))));
  await assertSucceeds(deleteDoc(doc(db('leader'), pr('p2'))));                                              // leaders can remove posts
});
test('a leader deleting the whole group can clear prayer records; members cannot', async () => {
  await assertFails(getDocs(collection(db('member'), pr('open') + '/responses')));
  await assertSucceeds(getDocs(collection(db('leader'), pr('open') + '/responses')));
  await assertSucceeds(deleteDoc(doc(db('leader'), pr('open') + '/responses/member2')));
});

// ---------- anonymous posts, devotions, likes, comments ----------
const dv = id => `churches/${cid}/devotions/${id}`;
const own = id => `churches/${cid}/owners/${id}`;
const newDevotion = (uid, patch = {}) => ({ uid, anon: false, ...box, likeCount: 0, createdAt: serverTimestamp(), ...patch });
const postAnon = async (who, path, id, data) => { const f = db(who), b = writeBatch(f); b.set(doc(f, path), { ...data, uid: null, anon: true }); b.set(doc(f, own(id)), { uid: who }); return b.commit(); };
test('anonymous prayer: nobody else can see who wrote it, but the author can still manage it', async () => {
  await assertSucceeds(postAnon('member2', pr('anon1'), 'anon1', newPrayer(null)));
  const seen = await getDoc(doc(db('leader'), pr('anon1')));
  if (seen.data().uid !== null || seen.data().anon !== true) throw new Error('author leaked');
  await assertFails(getDoc(doc(db('leader'), own('anon1'))));                                              // even leaders can't see the owner
  await assertFails(getDocs(collection(db('leader'), `churches/${cid}/owners`)));
  await assertSucceeds(getDocs(query(collection(db('member2'), `churches/${cid}/owners`), where('uid', '==', 'member2'))));
  await assertSucceeds(updateDoc(doc(db('member2'), pr('anon1')), { status: 'answered', answeredAt: serverTimestamp(), ...box }));
  await assertFails(updateDoc(doc(db('member'), pr('anon1')), { iv: 'eA==', ct: 'eA==' }));
  // anonymous + leaders only: the author can still open it
  await assertSucceeds(postAnon('member2', pr('anon2'), 'anon2', newPrayer(null, 'leaders')));
  await assertSucceeds(getDoc(doc(db('member2'), pr('anon2'))));
  await assertFails(getDoc(doc(db('member'), pr('anon2'))));
  await assertSucceeds(deleteDoc(doc(db('member2'), pr('anon2'))));
});
test('anonymous posts cannot be forged or claimed by someone else', async () => {
  await assertFails(setDoc(doc(db('member'), pr('anon3')), newPrayer(null, 'group', { anon: true })));       // no owner record
  { const f = db('member'), b = writeBatch(f); b.set(doc(f, pr('anon4')), newPrayer(null, 'group', { anon: true })); b.set(doc(f, own('anon4')), { uid: 'member2' }); await assertFails(b.commit()); }
  await assertFails(setDoc(doc(db('member'), own('open')), { uid: 'member' }));                              // claim an existing post
  await assertFails(setDoc(doc(db('member'), own('lonely')), { uid: 'member' }));                            // owner record without a post
  await assertFails(setDoc(doc(db('member'), pr('anon5')), newPrayer('member2', 'group')));                  // signed as someone else
  await assertFails(postAnon('pending', pr('anon6'), 'anon6', newPrayer(null)));
});
test('devotions: members share (signed or anonymous); outsiders cannot read or post', async () => {
  await assertSucceeds(setDoc(doc(db('member'), dv('d1')), newDevotion('member')));
  await assertSucceeds(postAnon('member2', dv('d2'), 'd2', newDevotion(null)));
  await assertSucceeds(getDocs(collection(db('leader'), `churches/${cid}/devotions`)));
  for (const uid of ['pending', 'removed', 'otherLeader']) await assertFails(getDoc(doc(db(uid), dv('d1'))));
  await assertFails(setDoc(doc(db('pending'), dv('d3')), newDevotion('pending')));
  await assertFails(setDoc(doc(db('member'), dv('d4')), newDevotion('member', { likeCount: 9 })));
  await assertFails(setDoc(doc(db('member'), dv('d5')), newDevotion('member', { body: 'plain text' })));
  await assertSucceeds(updateDoc(doc(db('member2'), dv('d2')), { iv: 'bmV3', ct: 'ZWRpdGVk' }));             // anonymous author edits
  await assertFails(updateDoc(doc(db('member'), dv('d2')), { iv: 'bmV3', ct: 'aGFjaw==' }));
  await assertFails(deleteDoc(doc(db('member'), dv('d2'))));
});
test('likes: once per person, can be undone, and the count cannot be forged', async () => {
  const like = (u, id, n = 1) => { const f = db(u), b = writeBatch(f); b.set(doc(f, dv(id) + '/likes/' + u), { createdAt: serverTimestamp() }); b.update(doc(f, dv(id)), { likeCount: increment(n) }); return b.commit(); };
  const unlike = (u, id) => { const f = db(u), b = writeBatch(f); b.delete(doc(f, dv(id) + '/likes/' + u)); b.update(doc(f, dv(id)), { likeCount: increment(-1) }); return b.commit(); };
  await assertSucceeds(like('member2', 'd1'));
  await assertFails(like('member2', 'd1'));
  await assertSucceeds(like('leader', 'd1'));
  await assertFails(like('member', 'd1', 3));
  await assertFails(updateDoc(doc(db('member'), dv('d1')), { likeCount: increment(1) }));
  await assertFails(unlike('member', 'd1'));                                                                 // never liked
  await assertSucceeds(unlike('member2', 'd1'));
  await assertFails(deleteDoc(doc(db('member'), dv('d1') + '/likes/leader')));
  const snap = await getDoc(doc(db('member'), dv('d1')));
  if (snap.data().likeCount !== 1) throw new Error('expected 1 like, got ' + snap.data().likeCount);
});
test('comments: members comment (signed or anonymous) on existing devotions; only the author or a leader deletes', async () => {
  const c = (uid, patch = {}) => ({ did: 'd1', uid, anon: false, ...box, createdAt: serverTimestamp(), ...patch });
  const cm = id => `churches/${cid}/devComments/${id}`;
  await assertSucceeds(setDoc(doc(db('member2'), cm('c1')), c('member2')));
  await assertSucceeds(postAnon('member', cm('c2'), 'c2', c(null)));
  await assertFails(setDoc(doc(db('member'), cm('c3')), c('member', { did: 'nope' })));
  await assertFails(setDoc(doc(db('pending'), cm('c4')), c('pending')));
  await assertFails(setDoc(doc(db('member'), cm('c5')), c('member2')));
  await assertSucceeds(getDocs(collection(db('member'), `churches/${cid}/devComments`)));
  await assertFails(getDocs(collection(db('otherLeader'), `churches/${cid}/devComments`)));
  await assertFails(deleteDoc(doc(db('member'), cm('c1'))));
  await assertSucceeds(deleteDoc(doc(db('member'), cm('c2'))));                                              // anonymous author
  await assertSucceeds(deleteDoc(doc(db('leader'), cm('c1'))));                                              // moderation
});
test('prayer comments: visible exactly to those who can see the prayer; anonymous comments hide the author', async () => {
  const pc = (p, id) => `churches/${cid}/prayers/${p}/comments/${id}`;
  const cm = (uid, patch = {}) => ({ uid, anon: false, ...box, createdAt: serverTimestamp(), ...patch });
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    await setDoc(doc(f, pr('cOpen')), { uid: 'member', anon: false, privacy: 'group', status: 'active', prayedCount: 0, ...box, createdAt: Timestamp.now(), answeredAt: null });
    await setDoc(doc(f, pr('cPriv')), { uid: 'member', anon: false, privacy: 'leaders', status: 'active', prayedCount: 0, ...box, createdAt: Timestamp.now(), answeredAt: null });
  });
  await assertSucceeds(setDoc(doc(db('member2'), pc('cOpen', 'k1')), cm('member2')));
  { const f = db('member2'), b = writeBatch(f); b.set(doc(f, pc('cOpen', 'k2')), cm(null, { anon: true })); b.set(doc(f, own('k2')), { uid: 'member2', kind: 'prayerComment', parent: 'cOpen' }); await assertSucceeds(b.commit()); }
  const got = await getDoc(doc(db('leader'), pc('cOpen', 'k2')));
  if (got.data().uid !== null) throw new Error('author leaked');
  await assertSucceeds(getDocs(collection(db('member'), `churches/${cid}/prayers/cOpen/comments`)));
  await assertFails(getDocs(collection(db('otherLeader'), `churches/${cid}/prayers/cOpen/comments`)));
  // leaders-only prayer: the author and leaders can comment and read; other members can't
  await assertSucceeds(setDoc(doc(db('leader'), pc('cPriv', 'k3')), cm('leader')));
  await assertSucceeds(getDocs(collection(db('member'), `churches/${cid}/prayers/cPriv/comments`)));
  await assertFails(getDocs(collection(db('member2'), `churches/${cid}/prayers/cPriv/comments`)));
  await assertFails(setDoc(doc(db('member2'), pc('cPriv', 'k4')), cm('member2')));
  // forging and claiming
  await assertFails(setDoc(doc(db('member'), pc('cOpen', 'k5')), cm('member2')));
  await assertFails(setDoc(doc(db('member'), own('k1')), { uid: 'member', kind: 'prayerComment', parent: 'cOpen' }));    // someone else's existing comment
  await assertFails(deleteDoc(doc(db('member'), pc('cOpen', 'k2'))));
  await assertSucceeds(deleteDoc(doc(db('member2'), pc('cOpen', 'k2'))));                                             // anonymous author
  await assertSucceeds(deleteDoc(doc(db('leader'), pc('cOpen', 'k1'))));                                              // moderation
});
test('posting: leaders and members a leader allowed can post announcements and events; others cannot', async () => {
  const ann = uid => ({ uid, pinned: false, ...box, createdAt: serverTimestamp() });
  const an = id => `churches/${cid}/announcements/${id}`;
  await assertSucceeds(setDoc(doc(db('leader'), an('a1')), ann('leader')));
  await assertFails(setDoc(doc(db('member'), an('a2')), ann('member')));
  await assertFails(setDoc(doc(db('member'), ev('m1')), newEvent('member')));
  // a member can't give themselves permission; a leader can
  await assertFails(updateDoc(doc(db('member'), `churches/${cid}/members/member`), { canPost: true }));
  await assertFails(updateDoc(doc(db('member2'), `churches/${cid}/members/member`), { canPost: true }));
  await assertFails(updateDoc(doc(db('leader'), `churches/${cid}/members/member`), { canPost: 'yes' }));
  await assertSucceeds(updateDoc(doc(db('leader'), `churches/${cid}/members/member`), { canPost: true }));
  await assertSucceeds(setDoc(doc(db('member'), an('a3')), ann('member')));
  await assertSucceeds(setDoc(doc(db('member'), ev('m2')), newEvent('member')));
  await assertSucceeds(updateDoc(doc(db('member'), ev('m2')), { ...box, startAt: Timestamp.fromMillis(Date.now() + 3 * 864e5), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('member'), ev('e1')), { ...box, updatedAt: serverTimestamp() }));   // someone else's event
  await assertFails(deleteDoc(doc(db('member'), an('a1'))));                                              // the leader's announcement
  await assertSucceeds(deleteDoc(doc(db('member'), an('a3'))));                                           // their own
  // permission taken away
  await assertSucceeds(updateDoc(doc(db('leader'), `churches/${cid}/members/member`), { canPost: false }));
  await assertFails(setDoc(doc(db('member'), an('a4')), ann('member')));
  await assertFails(deleteDoc(doc(db('member'), ev('m2'))));
  await assertSucceeds(deleteDoc(doc(db('leader'), ev('m2'))));
});
