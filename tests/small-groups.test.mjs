import { test } from 'node:test';
import assert from 'node:assert/strict';
import { churchRole, groupRole, validateGroup, createDemoSmallGroupsApi, createSmallGroupsApi } from '../site/small-groups.js';
const context = { churchId: 'church', user: { uid: 'member' }, church: { createdBy: 'owner' }, membership: { role: 'member' } };
const group = { name: 'Faith Group', description: '', leaderId: 'leader', memberIds: ['leader', 'member'], meetingDay: 'Friday', meetingTime: '19:30', meetingLocation: 'Room 2', imageUrl: '', status: 'active' };
test('church-scoped server claims and approved membership determine staff role', () => {
  assert.equal(churchRole(context), 'MEMBER');
  assert.equal(churchRole(context, { smallGroupRoles: { other: 'ADMIN' } }), 'MEMBER');
  assert.equal(churchRole(context, { smallGroupRoles: { church: 'PASTOR' } }), 'PASTOR');
  assert.equal(churchRole({ ...context, membership: { role: 'pending' } }, { smallGroupRoles: { church: 'ADMIN' } }), null);
  assert.equal(churchRole({ ...context, user: { uid: 'owner' }, membership: { role: 'leader' } }), 'ADMIN');
  assert.equal(churchRole({ ...context, user: { uid: 'owner' } }), 'MEMBER');
});
test('optional sample groups never cross church boundaries', async () => {
  let current = { ...context, churchId: 'first', user: { uid: 'me' }, church: { createdBy: 'me' }, membership: { role: 'leader' }, members: {} };
  const api = createDemoSmallGroupsApi(() => current);
  const read = cid => new Promise(resolve => {
    const stop = api.watch(cid, 'ADMIN', 'me', list => { stop(); resolve(list); });
  });
  assert.equal((await read('first')).length, 1);
  current = { ...current, churchId: 'second' };
  assert.deepEqual(await read('second'), []);
});
test('group leaders have no access to unrelated small groups', () => {
  assert.equal(groupRole('MEMBER', group, 'member'), 'MEMBER');
  assert.equal(groupRole('MEMBER', group, 'leader'), 'LEADER');
  assert.equal(groupRole('MEMBER', group, 'other'), null);
  assert.equal(groupRole(null, group, 'member'), null);
  assert.equal(groupRole('ADMIN', group, 'staff'), 'ADMIN');
});
test('group validation rejects unsafe images, duplicate membership and malformed schedules', () => {
  assert.equal(validateGroup(group), group);
  for (const patch of [{ imageUrl: 'javascript:alert(1)' }, { memberIds: ['member'] }, { memberIds: ['leader', 'leader'] }, { meetingTime: '25:00' }, { meetingDay: 'Someday' }, { name: ' ' }, { description: 'x'.repeat(501) }]) {
    assert.throws(() => validateGroup({ ...group, ...patch }));
  }
});
test('admin save updates the directory together with membership, keeps bios and removes former members', async () => {
  const base = 'churches/church/smallGroups/faith';
  const records = new Map([
    [base, { ...group, memberIds: ['leader', 'old'], createdAt: 'original-time' }],
    ['churches/church/members/leader', { name: 'Sarah Kim', role: 'member', photo: '' }],
    ['churches/church/members/member', { name: 'John Lee', role: 'member', photo: '' }],
    [base + '/members/leader', { firstName: 'Sarah', photo: '', bio: 'Glad to meet you.' }],
    [base + '/members/old', { firstName: 'Former', photo: '', bio: '' }]
  ]);
  const F = {
    doc: (_, ...parts) => ({ path: parts.join('/'), id: parts.at(-1) }),
    serverTimestamp: () => 'server-time',
    async runTransaction(_, work) {
      const writes = [];
      await work({
        async get(ref) {
          assert.equal(writes.length, 0, 'all reads must happen before writes');
          return { id: ref.id, exists: () => records.has(ref.path), data: () => records.get(ref.path) };
        },
        set: (ref, data) => writes.push(() => records.set(ref.path, data)),
        delete: ref => writes.push(() => records.delete(ref.path))
      });
      writes.forEach(commit => commit());
    }
  };
  const api = createSmallGroupsApi({ F, A: {}, db: {}, auth: {} });
  await api.save('church', 'faith', group, 'ADMIN');
  assert.deepEqual(records.get(base).memberIds, ['leader', 'member']);
  assert.equal(records.get(base).createdAt, 'original-time');
  assert.equal(records.get(base + '/members/leader').bio, 'Glad to meet you.');
  assert.deepEqual(records.get(base + '/members/member'), { firstName: 'John', photo: '', bio: '' });
  assert.equal(records.has(base + '/members/old'), false);
});
