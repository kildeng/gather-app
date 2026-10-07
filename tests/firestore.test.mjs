import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, addDoc, writeBatch, serverTimestamp, Timestamp, increment } from 'firebase/firestore';
let env;
const cid = 'church';
const path = id => `churches/${cid}/smallGroups/${id}`;
const data = (leaderId, memberIds) => ({ name: 'Faith Group', description: 'Grow together', leaderId, memberIds, meetingDay: 'Friday', meetingTime: '19:30', meetingLocation: 'Room 2', imageUrl: '', status: 'active', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
const db = (uid, claims) => env.authenticatedContext(uid, claims).firestore();
const claims = role => ({ smallGroupRoles: { [cid]: role } });
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-gather', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firebase/firestore.rules', import.meta.url), 'utf8') } });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const f = ctx.firestore();
    await setDoc(doc(f, `churches/${cid}`), { name: 'Church', createdBy: 'owner' });
    for (const uid of ['owner', 'leader', 'member', 'member2', 'otherLeader', 'admin', 'pastor', 'pending', 'removed']) await setDoc(doc(f, `churches/${cid}/members/${uid}`), { name: uid, role: ['owner', 'leader', 'otherLeader'].includes(uid) ? 'leader' : ['pending', 'removed'].includes(uid) ? uid : 'member' });
    await setDoc(doc(f, path('faith')), data('leader', ['leader', 'member', 'member2']));
    await setDoc(doc(f, path('other')), data('otherLeader', ['otherLeader']));
    await setDoc(doc(f, path('faith') + '/members/member'), { firstName: 'Member', photo: '', bio: '' });
    const prayer = (uid, privacy) => ({ uid, title: 'School', request: 'Please pray for an important exam this week.', category: 'School', privacy, status: 'active', testimony: '', prayedCount: 0, createdAt: Timestamp.now(), answeredAt: null });
    await setDoc(doc(f, path('faith') + '/prayers/private'), prayer('member', 'leaders'));
    await setDoc(doc(f, path('faith') + '/prayers/open'), prayer('member', 'group'));
    await setDoc(doc(f, path('other') + '/prayers/otherOpen'), prayer('otherLeader', 'group'));
  });
});
after(async () => { await env?.cleanup(); });
test('members may read and query their groups but cannot browse unrelated groups or directories', async () => {
  const f = db('member');
  await assertSucceeds(getDoc(doc(f, path('faith'))));
  await assertSucceeds(getDocs(query(collection(f, `churches/${cid}/smallGroups`), where('memberIds', 'array-contains', 'member'))));
  await assertSucceeds(getDocs(collection(f, path('faith') + '/members')));
  await assertFails(getDoc(doc(f, path('other'))));
  await assertFails(getDocs(collection(f, `churches/${cid}/smallGroups`)));
  await assertFails(getDocs(collection(db('otherLeader'), path('faith') + '/members')));
});
test('anonymous, pending, removed and outside-church users cannot read groups', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), path('faith'))));
  for (const uid of ['pending', 'removed', 'outsider']) await assertFails(getDoc(doc(db(uid, claims('ADMIN')), path('faith'))));
});
test('own leader may edit details but cannot change memberships or administer other groups', async () => {
  const f = db('leader');
  await assertSucceeds(updateDoc(doc(f, path('faith')), { meetingLocation: 'Room 3', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(f, path('faith')), { memberIds: ['leader'], updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(f, path('other')), { name: 'Changed', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('member'), path('faith')), { name: 'Changed', updatedAt: serverTimestamp() }));
});
test('admin manages all groups; pastor reads all but cannot administer; wrong-church claims do not elevate', async () => {
  await assertSucceeds(getDocs(collection(db('admin', claims('ADMIN')), `churches/${cid}/smallGroups`)));
  await assertSucceeds(updateDoc(doc(db('admin', claims('ADMIN')), path('other')), { status: 'archived', updatedAt: serverTimestamp() }));
  await assertSucceeds(getDocs(collection(db('pastor', claims('PASTOR')), `churches/${cid}/smallGroups`)));
  await assertFails(updateDoc(doc(db('pastor', claims('PASTOR')), path('other')), { name: 'Changed', updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(db('member', { smallGroupRoles: { elsewhere: 'ADMIN' } }), path('other'))));
  await assertFails(getDoc(doc(db('member', { role: 'ADMIN' }), path('other'))));
});
test('church owner creates groups; membership/directory batch is atomic and minimizes data', async () => {
  const f = db('owner'), b = writeBatch(f);
  b.set(doc(f, path('created')), { ...data('leader', ['leader', 'member']), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  for (const uid of ['leader', 'member']) b.set(doc(f, path('created') + `/members/${uid}`), { firstName: uid, photo: '', bio: '' });
  await assertSucceeds(b.commit());
  await assertFails(setDoc(doc(f, path('created') + '/members/member'), { firstName: 'Member', photo: '', bio: '', email: 'private@example.com' }));
  await assertFails(setDoc(doc(db('member'), path('created') + '/members/member'), { firstName: 'Forged', photo: '', bio: '' }));
});
test('membership removal immediately revokes document and directory access', async () => {
  const f = db('owner'), b = writeBatch(f);
  b.update(doc(f, path('created')), { memberIds: ['leader'], updatedAt: serverTimestamp() });
  b.delete(doc(f, path('created') + '/members/member'));
  await assertSucceeds(b.commit());
  await assertFails(getDoc(doc(db('member'), path('created'))));
  await assertFails(getDocs(collection(db('member'), path('created') + '/members')));
});
const pr = id => path('faith') + '/prayers/' + id;
const newPrayer = (uid, privacy = 'group', patch = {}) => ({ uid, title: 'Family', request: 'Please pray for my grandmother.', category: 'Family', privacy, status: 'active', testimony: '', prayedCount: 0, createdAt: serverTimestamp(), answeredAt: null, ...patch });
test('"Leaders Only" prayers are returned only to the author and the group leader', async () => {
  await assertSucceeds(getDoc(doc(db('member'), pr('private'))));
  await assertSucceeds(getDoc(doc(db('leader'), pr('private'))));
  for (const [uid, c] of [['member2'], ['pastor', claims('PASTOR')], ['admin', claims('ADMIN')], ['owner'], ['otherLeader'], ['outsider']]) await assertFails(getDoc(doc(db(uid, c), pr('private'))));
  // a plain list would include the leaders-only request, so it is refused; the group-only query is allowed
  await assertFails(getDocs(collection(db('member2'), path('faith') + '/prayers')));
  const open = await assertSucceeds(getDocs(query(collection(db('member2'), path('faith') + '/prayers'), where('privacy', '==', 'group'))));
  if (open.docs.some(d => d.data().privacy !== 'group')) throw new Error('leaders-only prayer leaked');
  await assertSucceeds(getDocs(query(collection(db('member2'), path('faith') + '/prayers'), where('uid', '==', 'member2'))));
  await assertSucceeds(getDocs(collection(db('leader'), path('faith') + '/prayers')));
});
test('group prayers: members of the group and pastors can read; other groups and outsiders cannot', async () => {
  await assertSucceeds(getDoc(doc(db('member2'), pr('open'))));
  await assertSucceeds(getDoc(doc(db('pastor', claims('PASTOR')), pr('open'))));
  await assertSucceeds(getDocs(query(collection(db('pastor', claims('PASTOR')), path('faith') + '/prayers'), where('privacy', '==', 'group'))));
  await assertFails(getDoc(doc(db('member'), path('other') + '/prayers/otherOpen')));
  await assertFails(getDoc(doc(db('otherLeader'), pr('open'))));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), pr('open'))));
  await assertFails(getDoc(doc(db('removed'), pr('open'))));
});
test('prayer request creation works for group members only, with valid fields', async () => {
  await assertSucceeds(setDoc(doc(db('member2'), pr('p1')), newPrayer('member2')));
  await assertSucceeds(setDoc(doc(db('member2'), pr('p2')), newPrayer('member2', 'leaders')));
  await assertFails(setDoc(doc(db('member2'), pr('p3')), newPrayer('member')));                      // pretending to be someone else
  await assertFails(setDoc(doc(db('otherLeader'), pr('p4')), newPrayer('otherLeader')));             // not in this group
  await assertFails(setDoc(doc(db('member2'), pr('p5')), newPrayer('member2', 'public')));
  await assertFails(setDoc(doc(db('member2'), pr('p6')), newPrayer('member2', 'group', { prayedCount: 50 })));
  await assertFails(setDoc(doc(db('member2'), pr('p7')), newPrayer('member2', 'group', { status: 'answered' })));
  await assertFails(setDoc(doc(db('member2'), pr('p8')), newPrayer('member2', 'group', { category: 'Gossip' })));
  await assertFails(setDoc(doc(db('pastor', claims('PASTOR')), pr('p9')), newPrayer('pastor')));      // staff outside the group can't post
});
test('"I Prayed" counts once per person and cannot be forged', async () => {
  const pray = async uid => { const f = db(uid), b = writeBatch(f); b.set(doc(f, pr('open') + '/responses/' + uid), { createdAt: serverTimestamp() }); b.update(doc(f, pr('open')), { prayedCount: increment(1) }); return b.commit(); };
  await assertSucceeds(pray('member2'));
  await assertFails(pray('member2'));                                                                // duplicate
  await assertSucceeds(pray('leader'));
  await assertFails(updateDoc(doc(db('member'), pr('open')), { prayedCount: increment(1) }));        // count without a response
  await assertFails(setDoc(doc(db('member'), pr('open') + '/responses/member'), { createdAt: serverTimestamp() })); // response without count
  { const f = db('member'), b = writeBatch(f); b.set(doc(f, pr('open') + '/responses/member'), { createdAt: serverTimestamp() }); b.update(doc(f, pr('open')), { prayedCount: increment(5) }); await assertFails(b.commit()); }
  { const f = db('member'), b = writeBatch(f); b.set(doc(f, pr('open') + '/responses/member2'), { createdAt: serverTimestamp() }); b.update(doc(f, pr('open')), { prayedCount: increment(1) }); await assertFails(b.commit()); } // as someone else
  await assertFails(deleteDoc(doc(db('member2'), pr('open') + '/responses/member2')));
  await assertFails(getDoc(doc(db('member'), pr('open') + '/responses/member2')));                    // who prayed stays private
  const snap = await getDoc(doc(db('member'), pr('open')));
  if (snap.data().prayedCount !== 2) throw new Error('expected 2, got ' + snap.data().prayedCount);
  // nobody outside can pray on a leaders-only request they cannot see
  { const f = db('member2'), b = writeBatch(f); b.set(doc(f, pr('private') + '/responses/member2'), { createdAt: serverTimestamp() }); b.update(doc(f, pr('private')), { prayedCount: increment(1) }); await assertFails(b.commit()); }
});
test('only the author or the group leader can mark a prayer answered and add a testimony', async () => {
  await assertFails(updateDoc(doc(db('member2'), pr('open')), { status: 'answered', answeredAt: serverTimestamp(), testimony: '' }));
  await assertFails(updateDoc(doc(db('pastor', claims('PASTOR')), pr('open')), { status: 'answered', answeredAt: serverTimestamp(), testimony: '' }));
  await assertSucceeds(updateDoc(doc(db('member'), pr('open')), { status: 'answered', answeredAt: serverTimestamp(), testimony: 'Passed the exam!' }));
  await assertSucceeds(updateDoc(doc(db('member'), pr('open')), { testimony: 'Passed the exam — thank you all!' }));
  await assertFails(updateDoc(doc(db('member'), pr('open')), { testimony: 'x'.repeat(501) }));
  await assertSucceeds(updateDoc(doc(db('leader'), pr('private')), { status: 'answered', answeredAt: serverTimestamp(), testimony: '' }));
  await assertFails(updateDoc(doc(db('member2'), pr('p1')), { request: 'edited by someone else' }));
  await assertFails(deleteDoc(doc(db('member2'), pr('open'))));
  await assertSucceeds(deleteDoc(doc(db('member2'), pr('p1'))));
});
test('check-in and other private care data still has no client access', async () => {
  for (const uid of ['member', 'leader', 'owner']) await assertFails(getDoc(doc(db(uid), path('faith') + '/checkins/x')));
});
test('invalid leaders, unsafe image schemes and spoofed timestamps are rejected', async () => {
  const f = db('owner');
  const base = { ...data('leader', ['leader']), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  for (const patch of [{ leaderId: 'outsider', memberIds: ['outsider'] }, { imageUrl: 'javascript:alert(1)' }, { updatedAt: Timestamp.fromMillis(0) }, { memberIds: ['leader', 'leader'] }]) await assertFails(setDoc(doc(f, path('invalid')), { ...base, ...patch }));
});
