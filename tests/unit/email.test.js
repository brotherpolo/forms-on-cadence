// Email PDF: templates, typed addresses and suggested addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, parseEmails, emailSuggestions, DEFAULT_SUBJECT, DEFAULT_MESSAGE, isEmail } from '../../src/emaillogic.js';

test('templates fill in fields and the special names', () => {
  const ctx = { field: (l) => ({ 'invoice #': 'INV-0058', total: 'CA$1,200.00' })[l.toLowerCase()], title: 'INV-0058', form: 'Invoices', item: 'Invoice', company: 'Pollack Renovations Inc.', sender: 'Adam', date: 'Oct 14, 2026' };
  assert.equal(fillTemplate(DEFAULT_SUBJECT, ctx), 'Invoice INV-0058 from Pollack Renovations Inc.');
  assert.equal(fillTemplate(DEFAULT_MESSAGE, ctx), 'Hello,\n\nPlease find invoice INV-0058 attached.\n\nThank you,\nAdam\nPollack Renovations Inc.');
  assert.equal(fillTemplate('Total {Total} on {date}; {Nope} stays', ctx), 'Total CA$1,200.00 on Oct 14, 2026; {Nope} stays');
  assert.equal(fillTemplate('{ Invoice # }', ctx), 'INV-0058', 'spaces inside braces are fine');
  assert.equal(fillTemplate('A {Total} ', { ...ctx, field: () => '' }), 'A  '.replace(/ {2,}/g, ' '), 'an empty field leaves no double space');
});

test('typed addresses', () => {
  assert.deepEqual(parseEmails('Sam@Client.com, office@x.ca; <a@b.co>\nsam@client.com'), { ok: ['sam@client.com', 'office@x.ca', 'a@b.co'], bad: [] });
  assert.deepEqual(parseEmails('nope, x@y'), { ok: [], bad: ['nope', 'x@y'] });
  assert.equal(isEmail('a@b.c'), false);
  assert.equal(isEmail('first.last+tag@sub.example.org'), true);
});

test('suggested addresses: the record, linked records, parents and their other children', () => {
  const forms = {
    inv: { id: 'inv', name: 'Invoices', fields: [{ id: 'bill', type: 'email', label: 'Billing email' }, { id: 'ct', type: 'relation', label: 'Contact', relForm: 'con' }] },
    cli: { id: 'cli', name: 'Clients', fields: [{ id: 'e', type: 'email', label: 'Main email' }] },
    con: { id: 'con', name: 'Contacts', fields: [{ id: 'e', type: 'email', label: 'Email' }] },
  };
  const recs = [
    { id: 'i1', formId: 'inv', parentId: 'c1', values: { bill: 'Billing@Acme.com', ct: 'k2' } },
    { id: 'c1', formId: 'cli', values: { e: 'ops@acme.com' } },
    { id: 'k1', formId: 'con', parentId: 'c1', values: { e: 'dana@acme.com' } },
    { id: 'k2', formId: 'con', parentId: 'c1', values: { e: 'sam@acme.com' } },
    { id: 'k3', formId: 'con', parentId: 'c1', values: { e: 'OPS@acme.com' } }, // same as the client's
    { id: 'x', formId: 'con', parentId: 'other', values: { e: 'stranger@x.com' } },
  ];
  const h = { formById: (id) => forms[id], recById: (id) => recs.find((r) => r.id === id), records: recs, recTitle: (r) => r.id };
  const s = emailSuggestions(recs[0], h);
  assert.deepEqual(s.map((x) => x.email), ['billing@acme.com', 'sam@acme.com', 'ops@acme.com', 'dana@acme.com']);
  assert.equal(s[0].where, 'This record · Billing email');
  assert.equal(s[1].where, 'Contacts · Email', 'the linked contact comes before the parent');
});
