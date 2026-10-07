import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, validatePrayer, prayerQueries, rsvpSummary, EVENT_KINDS, PRAYER_CATEGORIES } from '../site/small-groups.js';

test('events need a type, title and date; text lengths are limited', () => {
  const ok = { kind: 'Meeting', title: 'Friday Night Gathering', location: 'Room 2', description: '', startAt: Date.now() };
  assert.equal(validateEvent(ok), ok);
  assert.deepEqual([...EVENT_KINDS], ['Meeting', 'Worship', 'Event']);
  for (const patch of [{ kind: 'Party' }, { title: ' ' }, { title: 'x'.repeat(81) }, { location: 'x'.repeat(161) }, { description: 'x'.repeat(1001) }, { startAt: NaN }]) assert.throws(() => validateEvent({ ...ok, ...patch }));
});
test('prayer requests need a title, request, known category and privacy level', () => {
  const ok = { title: 'School', request: 'Please pray for an important exam this week.', category: 'School', privacy: 'group' };
  assert.equal(validatePrayer(ok), ok);
  assert.deepEqual([...PRAYER_CATEGORIES], ['Personal', 'Family', 'Health', 'School', 'Work', 'Faith', 'Other']);
  for (const patch of [{ title: '' }, { request: 'x'.repeat(1001) }, { category: 'Gossip' }, { privacy: 'public' }]) assert.throws(() => validatePrayer({ ...ok, ...patch }));
});
test('members only ask the server for group-wide prayers and their own; leaders for all', () => {
  assert.deepEqual(prayerQueries(true), [[]]);
  assert.deepEqual(prayerQueries(false), [[['privacy', '==', 'group']], [['uid', '==', '$me']]]);
});
test('RSVP summary counts only current members and ignores unknown answers', () => {
  const members = { a: { role: 'member' }, b: { role: 'leader' }, c: { role: 'removed' }, d: { role: 'member' } };
  assert.deepEqual(rsvpSummary({ a: 'going', b: 'maybe', c: 'going', d: 'no', e: 'going', a2: 'weird' }, members), { going: ['a'], maybe: ['b'], no: ['d'] });
  assert.deepEqual(rsvpSummary(undefined, members), { going: [], maybe: [], no: [] });
});
