// Comments and @mentions: threads, the @ list, who's mentioned, and what people are told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threads, shownCount, mentionQuery, matchPeople, insertMention, mentionsIn, parts, andList, notifyLine, notifiedNotes, canSeeRecord, initials, avatarColor, ago, unreadOf } from '../../src/commentlogic.js';

test('threads: comments oldest first, each followed by its replies', () => {
  const list = [
    { id: 'b', at: 3, parent: null }, { id: 'a', at: 1, parent: null },
    { id: 'r2', at: 5, parent: 'a' }, { id: 'r1', at: 2, parent: 'a' }, { id: 'lost', at: 4, parent: 'gone' },
  ];
  assert.deepEqual(threads(list).map((x) => [x.c.id, x.reply]), [['a', false], ['r1', true], ['r2', true], ['b', false]]);
  assert.equal(shownCount(list), 4, 'a reply to a removed comment isn’t shown');
  assert.deepEqual(threads(null), []);
});

test('the @word being typed', () => {
  assert.deepEqual(mentionQuery('Hi @sa', 6), { q: 'sa', start: 3 });
  assert.deepEqual(mentionQuery('@', 1), { q: '', start: 0 });
  assert.deepEqual(mentionQuery('Hi @Sam L', 9), { q: 'Sam L', start: 3 });
  assert.equal(mentionQuery('email me@home.com', 17), null, 'not inside an email address');
  assert.equal(mentionQuery('Hi @Sam Lee and', 15), null, 'two spaces end it');
  assert.equal(mentionQuery('Hi @sa', 2), null, 'the caret is before it');
  assert.deepEqual(mentionQuery('(@k', 3), { q: 'k', start: 1 });
});

test('finding people: name, any word of it, or email; people who can’t see it last', () => {
  const ppl = [{ uid: 'a', name: 'Sam Lee', email: 'sam@x.com' }, { uid: 'b', name: 'Lisa Samson', email: 'lisa@x.com' }, { uid: 'c', name: 'Kim', email: 'k@x.com' }, { uid: 'd', name: 'Samir', off: true, email: '' }, { uid: 'e', name: 'José', email: '' }];
  assert.deepEqual(matchPeople(ppl, 'sam').map((p) => p.uid), ['a', 'b', 'd']);
  assert.deepEqual(matchPeople(ppl, 'k@').map((p) => p.uid), ['c']);
  assert.deepEqual(matchPeople(ppl, 'jose').map((p) => p.uid), ['e'], 'accents don’t matter');
  assert.equal(matchPeople(ppl, '').length, 5);
  assert.equal(matchPeople(ppl, '', 2).length, 2);
  assert.deepEqual(matchPeople(ppl, 'zz'), []);
});

test('picking someone puts their full name in', () => {
  assert.deepEqual(insertMention('Hi @sa thanks', 3, 6, 'Sam Lee'), { text: 'Hi @Sam Lee thanks', caret: 12 });
  assert.deepEqual(insertMention('@k', 0, 2, 'Kim'), { text: '@Kim ', caret: 5 });
});

test('who a comment mentions', () => {
  const ppl = [{ uid: 'a', name: 'Sam Lee' }, { uid: 'b', name: 'Sam' }, { uid: 'c', name: 'Kim' }];
  assert.deepEqual(mentionsIn('Hi @Sam Lee and @Kim', [], ppl), [{ uid: 'a', name: 'Sam Lee' }, { uid: 'c', name: 'Kim' }], 'longest name wins');
  assert.deepEqual(mentionsIn('Hi @Sam, ok?', [], ppl), [{ uid: 'b', name: 'Sam' }]);
  assert.deepEqual(mentionsIn('Hi @Samantha', [], ppl), [], 'part of a longer word doesn’t count');
  assert.deepEqual(mentionsIn('Hi @Kim', [{ uid: 'c2', name: 'Kim' }], ppl), [{ uid: 'c2', name: 'Kim' }], 'the one picked from the list wins over a namesake');
  assert.deepEqual(mentionsIn('removed it', [{ uid: 'c', name: 'Kim' }], ppl), [], 'picked, then deleted from the text');
  assert.deepEqual(mentionsIn('@Kim @Kim', [], ppl).length, 1);
  const many = Array.from({ length: 30 }, (_, i) => ({ uid: 'u' + i, name: 'P' + i + 'x' }));
  assert.equal(mentionsIn(many.map((p) => '@' + p.name).join(' '), [], many).length, 20);
});

test('the text in pieces for the pills', () => {
  assert.deepEqual(parts('Hi @Sam Lee, see @Kim.', [{ uid: 'a', name: 'Sam Lee' }, { uid: 'c', name: 'Kim' }]), [
    { t: 'Hi ' }, { t: '@Sam Lee', uid: 'a' }, { t: ', see ' }, { t: '@Kim', uid: 'c' }, { t: '.' }]);
  assert.deepEqual(parts('@Kimberly', [{ uid: 'c', name: 'Kim' }]), [{ t: '@Kimberly' }]);
  assert.deepEqual(parts('plain', []), [{ t: 'plain' }]);
  assert.deepEqual(parts('', []), []);
});

test('who will be told', () => {
  assert.equal(andList(['A']), 'A');
  assert.equal(andList(['A', 'B']), 'A and B');
  assert.equal(andList(['A', 'B', 'C']), 'A, B and C');
  assert.equal(andList(['A', 'B', 'C', 'D', 'E']), 'A, B and 3 others');
  const ms = [{ uid: 'a', name: 'Sam Lee' }, { uid: 'c', name: 'Kim' }];
  assert.equal(notifyLine(ms), 'Sam and Kim will get an email.');
  assert.equal(notifyLine(ms, { task: true }), 'Sam and Kim will get an email and a Cadence task.');
  assert.equal(notifyLine(ms, { off: new Set(['c']) }), 'Sam will get an email. Kim can’t see this record.');
  assert.equal(notifyLine([]), '');
});

test('notes for the people who weren’t told', () => {
  const c = { mentions: [{ uid: 'a', name: 'Sam' }, { uid: 'b', name: 'Kim' }, { uid: 'z', name: 'Old' }], notified: { a: 'sent', b: 'no-access', z: 'gone' } };
  assert.deepEqual(notifiedNotes(c), ['Kim can’t see this record and wasn’t notified.', 'Old no longer has an account and wasn’t notified.']);
  assert.deepEqual(notifiedNotes({ mentions: [], notified: {} }), []);
  assert.deepEqual(notifiedNotes({ mentions: [{ uid: 'a', name: 'A' }, { uid: 'b', name: 'B' }], notified: { a: 'no-access', b: 'no-access' } }), ['A and B can’t see this record and weren’t notified.']);
});

test('who can see a record: the same as the rules', () => {
  const rec = { formId: 'f', ownerId: 'o' };
  assert.equal(canSeeRecord({ role: 'admin' }, rec, 'x'), true);
  assert.equal(canSeeRecord({ access: { '*': { view: 'all' } } }, rec, 'x'), true);
  assert.equal(canSeeRecord({ access: { '*': { view: 'own' } } }, rec, 'o'), true);
  assert.equal(canSeeRecord({ access: { '*': { view: 'own' } } }, rec, 'x'), false);
  assert.equal(canSeeRecord({ access: { f: { view: 'none' }, '*': { view: 'all' } } }, rec, 'x'), false);
  assert.equal(canSeeRecord({ groups: ['g'] }, { ...rec, assigneeGroup: 'g' }, 'x'), true);
  assert.equal(canSeeRecord(null, rec, 'x'), false);
});

test('avatars, times and unread', () => {
  assert.equal(initials('Adam Pollack'), 'AP');
  assert.equal(initials('sam'), 'S');
  assert.equal(initials('Mary Jo Smith'), 'MS');
  assert.equal(initials(''), '?');
  assert.equal(avatarColor('u1'), avatarColor('u1'));
  assert.match(avatarColor('x'), /^#[0-9a-f]{6}$/);
  const now = new Date(2026, 9, 15, 15, 0).getTime();
  assert.equal(ago(now - 20e3, now), 'just now');
  assert.equal(ago(now - 5 * 60e3, now), '5 min ago');
  assert.equal(ago(now - 3 * 3600e3, now), '3 h ago');
  assert.equal(ago(new Date(2026, 9, 14, 9, 0).getTime(), now), 'Yesterday');
  assert.equal(ago(new Date(2026, 9, 1).getTime(), now, () => 'Oct 1'), 'Oct 1');
  assert.equal(unreadOf([{ read: false }, { read: true }, {}]).length, 2);
});
