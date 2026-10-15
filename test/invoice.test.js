// Unit tests for the pure validation logic.  Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../code/lib/invoice.js');

const NOW = '2026-10-15T12:00:00Z';
const good = () => ({
  document_type: 'invoice',
  vendor_name: 'Nordlys Kontor AS',
  vendor_vat_id: 'NO 923 456 789 MVA',
  invoice_number: '2026-0412',
  invoice_date: '2026-10-01',
  due_date: '2026-10-15',
  currency: 'nok',
  subtotal: 4000,
  tax_amount: 1000,
  tax_rate: 25,
  total: 5000,
  payment_reference: '1234567890',
  line_items: [
    { description: 'Office chairs', quantity: 2, unit_price: 1500, amount: 3000 },
    { description: 'Delivery', quantity: 1, unit_price: 1000, amount: 1000 },
  ],
  confidence: 0.95,
});

test('clean invoice is auto-approved and normalised', () => {
  const r = L.validateInvoice(good(), { now: NOW });
  assert.strictEqual(r.status, 'auto_approved');
  assert.deepStrictEqual(r.flags, []);
  assert.strictEqual(r.invoice.currency, 'NOK');
  assert.strictEqual(r.invoice.vendor_vat_id, 'NO923456789MVA');
});

test('arithmetic errors are caught', () => {
  const inv = good();
  inv.total = 5100;
  inv.line_items[0].amount = 3100;
  const r = L.validateInvoice(inv, { now: NOW });
  assert.strictEqual(r.status, 'needs_review');
  assert.ok(r.flags.includes('subtotal + tax ≠ total'));
  assert.ok(r.flags.includes('line 1: quantity × price ≠ amount'));
  assert.ok(r.flags.includes('line items do not add up to subtotal'));
});

test('rounding within 2 cents is tolerated (float-safe)', () => {
  const inv = good();
  inv.subtotal = 0.1 + 0.2;            // 0.30000000000000004
  inv.tax_amount = 0.07; inv.tax_rate = 25; inv.total = 0.38;
  inv.line_items = [{ description: 'x', quantity: 3, unit_price: 0.1, amount: 0.3 }];
  const r = L.validateInvoice(inv, { now: NOW });
  assert.deepStrictEqual(r.flags, []);
});

test('line items printed gross (incl. tax) are accepted', () => {
  const inv = good();
  inv.line_items = [{ description: 'All incl. VAT', quantity: 1, unit_price: 5000, amount: 5000 }];
  assert.deepStrictEqual(L.validateInvoice(inv, { now: NOW }).flags, []);
});

test('wrong tax rate is flagged', () => {
  const inv = good();
  inv.tax_rate = 15;
  assert.ok(L.validateInvoice(inv, { now: NOW }).flags.includes('tax amount does not match tax rate'));
});

test('missing fields, bad dates and bad currency are flagged', () => {
  const r = L.validateInvoice({
    document_type: 'invoice', vendor_name: '', invoice_number: '', invoice_date: '2026-02-30',
    currency: 'kr', total: null, line_items: [], confidence: 0.9,
  }, { now: NOW });
  for (const f of ['missing vendor', 'missing invoice number', 'missing or invalid invoice date', 'missing total', 'invalid currency']) {
    assert.ok(r.flags.includes(f), f);
  }
});

test('future, very old and due-before-issue dates are flagged', () => {
  const a = good(); a.invoice_date = '2026-12-01'; a.due_date = '2026-12-31';
  assert.ok(L.validateInvoice(a, { now: NOW }).flags.includes('invoice date in the future'));
  const b = good(); b.invoice_date = '2023-01-01'; b.due_date = '2023-01-15';
  assert.ok(L.validateInvoice(b, { now: NOW }).flags.includes('invoice older than 2 years'));
  const c = good(); c.due_date = '2026-09-01';
  assert.ok(L.validateInvoice(c, { now: NOW }).flags.includes('due date before invoice date'));
});

test('business rules: approval limit, credit note, low confidence', () => {
  const big = good();
  big.subtotal = 40000; big.tax_amount = 10000; big.total = 50000;
  big.line_items = [{ description: 'Server', quantity: 1, unit_price: 40000, amount: 40000 }];
  assert.ok(L.validateInvoice(big, { now: NOW }).flags.some((f) => f.startsWith('total above approval limit')));
  const eur = good(); eur.currency = 'EUR'; // 5000 EUR is over the EUR limit, 5000 NOK is not
  assert.ok(L.validateInvoice(eur, { now: NOW }).flags.includes('total above approval limit (1000 EUR)'));
  const cn = good(); cn.document_type = 'credit_note';
  assert.ok(L.validateInvoice(cn, { now: NOW }).flags.includes('credit note'));
  const low = good(); low.confidence = 0.5;
  assert.ok(L.validateInvoice(low, { now: NOW }).flags.includes('low model confidence'));
});

test('non-invoices are skipped, unknown types treated as non-invoice', () => {
  assert.strictEqual(L.validateInvoice({ document_type: 'not_invoice' }).status, 'skipped');
  assert.strictEqual(L.validateInvoice({ document_type: 'banana' }).status, 'skipped');
});

test('string numbers with decimal comma are parsed', () => {
  const inv = good();
  inv.subtotal = '4000,00'; inv.tax_amount = '1 000'; inv.total = '5000';
  assert.deepStrictEqual(L.validateInvoice(inv, { now: NOW }).flags, []);
});

test('invoiceKey prefers VAT id and is case-insensitive', () => {
  const inv = L.validateInvoice(good(), { now: NOW }).invoice;
  assert.strictEqual(L.invoiceKey(inv), 'NO923456789MVA|2026-0412');
  inv.vendor_vat_id = '';
  assert.strictEqual(L.invoiceKey(inv), 'nordlys-kontor-as|2026-0412');
  inv.invoice_number = '';
  assert.strictEqual(L.invoiceKey(inv), '');
});

test('rememberKey dedupes and stays bounded', () => {
  const store = {};
  assert.strictEqual(L.rememberKey(store, 'a'), true);
  assert.strictEqual(L.rememberKey(store, 'a'), false);
  for (let i = 0; i < L.CONFIG.MAX_REMEMBERED_KEYS + 10; i++) L.rememberKey(store, 'k' + i);
  assert.strictEqual(store.order.length, L.CONFIG.MAX_REMEMBERED_KEYS);
  assert.strictEqual(L.rememberKey(store, 'a'), true); // evicted long ago
});

test('archive file name is safe and sortable', () => {
  const inv = L.validateInvoice({ ...good(), vendor_name: 'Café Ørn & Søn / Ltd', invoice_number: 'INV/22#1' }, { now: NOW }).invoice;
  assert.strictEqual(L.archiveFileName(inv, 'scan.JPG'), '2026-10-01_Cafe-Orn-Son-Ltd_INV-22-1.jpg');
  assert.strictEqual(L.archiveFileName(L.validateInvoice({ document_type: 'invoice' }).invoice, 'x'), 'no-date_unknown_unknown.pdf');
});

test('Gemini body carries schema and file; response parsing fails loudly', () => {
  const body = L.buildGeminiBody('QUJD', 'application/pdf');
  assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
  assert.strictEqual(body.contents[0].parts[1].inline_data.data, 'QUJD');
  assert.ok(body.generationConfig.responseSchema.required.includes('total'));
  assert.deepStrictEqual(L.parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }), { a: 1 });
  assert.throws(() => L.parseGeminiResponse({ candidates: [] }), /Empty Gemini response/);
});
