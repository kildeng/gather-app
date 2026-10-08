import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, validatePrayer, validateDevotion, validateComment, dayLabel, prayerQueries, rsvpSummary, EVENT_KINDS, PRAYER_CATEGORIES } from '../site/small-groups.js';

test('events need a type, title and date; text lengths are limited', () => {
  const ok = { kind: 'Meeting', title: 'Friday Night Gathering', location: 'Room 2', description: '', startAt: Date.now() };
  assert.equal(validateEvent(ok), ok);
  assert.deepEqual([...EVENT_KINDS], ['Meeting', 'Worship', 'Event']);
  for (const patch of [{ kind: 'Party' }, { title: ' ' }, { title: 'x'.repeat(81) }, { location: 'x'.repeat(161) }, { description: 'x'.repeat(1001) }, { startAt: NaN }]) assert.throws(() => validateEvent({ ...ok, ...patch }));
});
test('prayer requests need a title, request, known category and privacy level', () => {
  const ok = { title: 'School', request: 'Please pray for an important exam this week.', category: 'School', privacy: 'group', anon: false };
  assert.equal(validatePrayer(ok), ok);
  assert.deepEqual([...PRAYER_CATEGORIES], ['Personal', 'Family', 'Health', 'School', 'Work', 'Faith', 'Other']);
  for (const patch of [{ title: '' }, { request: 'x'.repeat(1001) }, { category: 'Gossip' }, { privacy: 'public' }, { anon: 'yes' }]) assert.throws(() => validatePrayer({ ...ok, ...patch }));
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
test('devotions need a reflection; reference and verse are optional; comments are limited', () => {
  const ok = { ref: 'Psalm 23:1', verse: 'The Lord is my shepherd', body: 'God knows what I need.', anon: true };
  assert.equal(validateDevotion(ok), ok);
  assert.equal(validateDevotion({ ...ok, ref: '', verse: '' }).body, ok.body);
  for (const patch of [{ body: ' ' }, { body: 'x'.repeat(3001) }, { ref: 'x'.repeat(101) }, { verse: 'x'.repeat(1501) }, { anon: undefined }]) assert.throws(() => validateDevotion({ ...ok, ...patch }));
  assert.equal(validateComment('Amen!'), 'Amen!');
  for (const bad of ['', '   ', 'x'.repeat(1001)]) assert.throws(() => validateComment(bad));
});
test('devotions are grouped as Today / Yesterday / date', () => {
  const now = new Date(2026, 9, 7, 12).getTime();
  assert.equal(dayLabel(now - 3600e3, now), 'Today');
  assert.equal(dayLabel(now - 864e5, now), 'Yesterday');
  assert.match(dayLabel(now - 3 * 864e5, now), /October 4|Oct 4/);
});
import { bibleName, youVersionUrl, BIBLE_NAMES } from '../site/small-groups.js';
test('anonymous posts get a stable Bible name from the post id', () => {
  assert.equal(bibleName('abc'), bibleName('abc'));
  assert.ok(BIBLE_NAMES.includes(bibleName('anything')));
  const names = new Set(Array.from({ length: 40 }, (_, i) => bibleName('post' + i)));
  assert.ok(names.size > 10, 'names should vary between posts');
  const avoid = BIBLE_NAMES.filter(n => n !== 'Ruth');
  assert.equal(bibleName('anything', avoid), 'Ruth');                      // skips real members' names
  assert.equal(bibleName('x', BIBLE_NAMES), 'Friend');
});
test('Bible references link to the YouVersion passage', () => {
  assert.equal(youVersionUrl('John 3:16'), 'https://www.bible.com/bible/111/JHN.3.16');
  assert.equal(youVersionUrl('1 John 4:8'), 'https://www.bible.com/bible/111/1JN.4.8');
  assert.equal(youVersionUrl('Psalm 23:1–3'), 'https://www.bible.com/bible/111/PSA.23.1-3');
  assert.equal(youVersionUrl('1Cor 13'), 'https://www.bible.com/bible/111/1CO.13');
  assert.equal(youVersionUrl('Song of Songs 2:1'), 'https://www.bible.com/bible/111/SNG.2.1');
  assert.match(youVersionUrl('not a verse'), /bible\.com\/search\/bible\?query=not%20a%20verse/);
});
import { BIBLE_BOOKS, stepChapter, localDate } from '../site/bible.js';
test('Bible reader: 66 books, 1189 chapters, and prev/next crosses book edges', () => {
  assert.equal(BIBLE_BOOKS.length, 66);
  assert.equal(BIBLE_BOOKS.reduce((n, b) => n + b[2], 0), 1189);
  assert.deepEqual(stepChapter('GEN', 50, 1), ['EXO', 1]);
  assert.deepEqual(stepChapter('EXO', 1, -1), ['GEN', 50]);
  assert.deepEqual(stepChapter('PSA', 23, 1), ['PSA', 24]);
  assert.equal(stepChapter('GEN', 1, -1), null);
  assert.equal(stepChapter('REV', 22, 1), null);
  assert.match(localDate(new Date(2026, 9, 8)), /^2026-10-08$/);
});
