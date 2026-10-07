import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, query, where, setDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
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
    for (const uid of ['owner', 'leader', 'member', 'otherLeader', 'admin', 'pastor', 'pending', 'removed']) await setDoc(doc(f, `churches/${cid}/members/${uid}`), { name: uid, role: ['owner', 'leader', 'otherLeader'].includes(uid) ? 'leader' : ['pending', 'removed'].includes(uid) ? uid : 'member' });
    await setDoc(doc(f, path('faith')), data('leader', ['leader', 'member']));
    await setDoc(doc(f, path('other')), data('otherLeader', ['otherLeader']));
    await setDoc(doc(f, path('faith') + '/members/member'), { firstName: 'Member', photo: '', bio: '' });
    await setDoc(doc(f, path('faith') + '/prayers/private'), { privacy: 'Leaders Only', request: 'private' });
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
test('future private prayer and check-in data has no client access grants in Phase 1', async () => {
  for (const uid of ['member', 'leader', 'owner']) await assertFails(getDoc(doc(db(uid), path('faith') + '/prayers/private')));
});
test('invalid leaders, unsafe image schemes and spoofed timestamps are rejected', async () => {
  const f = db('owner');
  const base = { ...data('leader', ['leader']), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  for (const patch of [{ leaderId: 'outsider', memberIds: ['outsider'] }, { imageUrl: 'javascript:alert(1)' }, { updatedAt: Timestamp.fromMillis(0) }, { memberIds: ['leader', 'leader'] }]) await assertFails(setDoc(doc(f, path('invalid')), { ...base, ...patch }));
});
