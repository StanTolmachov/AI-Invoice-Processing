// Runs the exact Code-node sources (lib + glue, as built into the workflow) with
// mocked n8n globals: $input, $getWorkflowStaticData, $, $json, this.helpers.
const test = require('node:test');
const assert = require('node:assert');
const { nodeCode } = require('../scripts/build.js');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function runNode(file, { items = [], staticData = {}, refs = {}, json, helpers } = {}) {
  const fn = new AsyncFunction('$input', '$getWorkflowStaticData', '$', '$json', 'console', nodeCode(file));
  const $input = { all: () => items };
  const $ = (name) => {
    if (!refs[name]) throw new Error('unknown node ref ' + name);
    return refs[name];
  };
  return fn.call({ helpers }, $input, () => staticData, $, json, { log: () => {} });
}

const bin = (fileName, mimeType, text) => ({ fileName, mimeType, data: Buffer.from(text).toString('base64') });
const gmailItem = () => ({
  json: { id: 'msg-1', subject: 'Invoice October', from: { value: [{ address: 'billing@vendor.example' }] }, date: '2026-10-15T08:00:00Z' },
  binary: {
    attachment_0: bin('invoice-0412.pdf', 'application/pdf', '%PDF fake'),
    attachment_1: bin('invite.ics', 'text/calendar', 'BEGIN:VCALENDAR'),
    attachment_2: bin('receipt.jpg', 'image/jpeg', 'jpgdata'),
  },
});
const helpers = (items) => ({
  getBinaryDataBuffer: async (i, prop) => Buffer.from(items[i].binary[prop].data, 'base64'),
});
const geminiOk = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const invoice = (over) => ({
  document_type: 'invoice', vendor_name: 'Nordlys Kontor AS', vendor_vat_id: 'NO923456789MVA',
  invoice_number: '2026-0412', invoice_date: new Date().toISOString().slice(0, 10), currency: 'NOK',
  subtotal: 4000, tax_amount: 1000, tax_rate: 25, total: 5000,
  line_items: [{ description: 'Chairs', quantity: 2, unit_price: 2000, amount: 4000 }], confidence: 0.95, ...over,
});

test('split: keeps PDF and images, drops other types, dedupes across runs', async () => {
  const sd = {};
  const first = await runNode('split-attachments.js', { items: [gmailItem()], staticData: sd });
  assert.deepStrictEqual(first.map((x) => x.json.fileName), ['invoice-0412.pdf', 'receipt.jpg']);
  assert.strictEqual(first[0].json.from, 'billing@vendor.example');
  assert.ok(first[0].binary.data);
  const second = await runNode('split-attachments.js', { items: [gmailItem()], staticData: sd });
  assert.strictEqual(second.length, 0);
});

test('prepare: builds Gemini body with base64 file and keeps binary', async () => {
  const items = await runNode('split-attachments.js', { items: [gmailItem()] });
  const out = await runNode('prepare-request.js', { items, helpers: helpers(items) });
  assert.strictEqual(out.length, 2);
  const part = out[0].json.geminiBody.contents[0].parts[1].inline_data;
  assert.strictEqual(Buffer.from(part.data, 'base64').toString(), '%PDF fake');
  assert.strictEqual(part.mime_type, 'application/pdf');
  assert.ok(out[0].binary.data);
});

async function pipeline(responses, staticData = {}) {
  const split = await runNode('split-attachments.js', { items: [gmailItem()], staticData });
  const prepared = await runNode('prepare-request.js', { items: split, helpers: helpers(split) });
  const httpOut = responses.map((r) => ({ json: r }));
  return runNode('validate-route.js', {
    items: httpOut, staticData, refs: { 'Prepare Gemini request': { all: () => prepared } },
  });
}

test('validate: approves clean invoice, flags broken one, never drops a failed AI call', async () => {
  const out = await pipeline([geminiOk(invoice()), { error: { message: '429 Resource exhausted' } }]);
  assert.strictEqual(out.length, 2);
  const [a, b] = out;
  assert.strictEqual(a.json._status, 'auto_approved');
  assert.strictEqual(a.json.Vendor, 'Nordlys Kontor AS');
  assert.match(a.json.File, /^\d{4}-\d{2}-\d{2}_Nordlys-Kontor-AS_2026-0412\.pdf$/);
  assert.strictEqual(a.json['Source File'], 'invoice-0412.pdf');
  assert.ok(a.binary.data, 'binary passes through for Drive upload');
  assert.strictEqual(b.json._status, 'needs_review');
  assert.match(b.json.Flags, /extraction failed: 429 Resource exhausted/);
  assert.strictEqual(b.json['Source File'], 'receipt.jpg');
});

test('validate: same invoice in a different email is flagged as duplicate', async () => {
  const sd = {};
  await pipeline([geminiOk(invoice()), geminiOk({ document_type: 'not_invoice' })], sd);
  // new email id → passes file dedupe, but vendor + invoice number were seen
  const split = await runNode('split-attachments.js', {
    items: [{ ...gmailItem(), json: { ...gmailItem().json, id: 'msg-2' } }], staticData: sd,
  });
  const prepared = await runNode('prepare-request.js', { items: split, helpers: helpers(split) });
  const out = await runNode('validate-route.js', {
    items: [{ json: geminiOk(invoice()) }, { json: geminiOk({ document_type: 'not_invoice' }) }],
    staticData: sd, refs: { 'Prepare Gemini request': { all: () => prepared } },
  });
  assert.strictEqual(out[0].json._status, 'needs_review');
  assert.match(out[0].json.Flags, /possible duplicate invoice/);
  assert.strictEqual(out[1].json._status, 'skipped');
});

test('validate: malformed model JSON becomes needs_review, not a crash', async () => {
  const out = await pipeline([{ candidates: [{ content: { parts: [{ text: '{oops' }] } }] }, geminiOk(invoice({ invoice_number: 'B-1' }))]);
  assert.strictEqual(out[0].json._status, 'needs_review');
  assert.match(out[0].json.Flags, /extraction failed/);
});

test('add drive link: merges Drive file id into the row', async () => {
  const row = { Vendor: 'X', _status: 'auto_approved' };
  const out = await runNode('add-drive-link.js', { json: { id: 'abc123' }, refs: { 'Validate & route': { item: { json: row } } } });
  assert.strictEqual(out.json['File Link'], 'https://drive.google.com/file/d/abc123/view');
  assert.strictEqual(out.json.Vendor, 'X');
});
