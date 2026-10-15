// Generates fictional sample invoices for testing the workflow end to end.
//   npm i -D playwright && node scripts/make-samples.js
const { chromium } = require('playwright');
const path = require('path');

const css = `
  body{font-family:Inter,Helvetica,Arial,sans-serif;color:#1d2125;margin:48px;font-size:13px}
  h1{font-size:26px;margin:0 0 4px} .muted{color:#667085}
  .top{display:flex;justify-content:space-between;margin-bottom:28px}
  table{width:100%;border-collapse:collapse;margin-top:18px}
  th{text-align:left;border-bottom:2px solid #1d2125;padding:8px 6px;font-size:12px}
  td{border-bottom:1px solid #e4e7ec;padding:8px 6px} .r{text-align:right}
  .tot{width:300px;margin-left:auto;margin-top:16px} .tot td{border:none;padding:4px 6px}
  .tot tr:last-child td{font-weight:700;font-size:15px;border-top:2px solid #1d2125}
  .box{margin-top:28px;padding:12px 14px;background:#f2f4f7;border-radius:6px}`;

const money = (n, loc) => n.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function invoiceHtml(d) {
  const rows = d.lines.map((l) => `<tr><td>${l[0]}</td><td class="r">${l[1]}</td><td class="r">${money(l[2], d.loc)}</td><td class="r">${money(l[3], d.loc)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
  <div class="top"><div><h1>${d.vendor}</h1><div class="muted">${d.vendorInfo}</div></div>
  <div style="text-align:right"><h1>${d.title}</h1><div>${d.labels.no}: <b>${d.number}</b></div>
  <div>${d.labels.date}: ${d.date}</div><div>${d.labels.due}: ${d.due}</div></div></div>
  <div><b>${d.labels.to}:</b> ${d.customer}</div>
  <table><tr><th>${d.labels.desc}</th><th class="r">${d.labels.qty}</th><th class="r">${d.labels.price}</th><th class="r">${d.labels.amount}</th></tr>${rows}</table>
  <table class="tot"><tr><td>${d.labels.sub}</td><td class="r">${money(d.sub, d.loc)}</td></tr>
  <tr><td>${d.labels.tax}</td><td class="r">${money(d.tax, d.loc)}</td></tr>
  <tr><td>${d.labels.total} ${d.cur}</td><td class="r">${money(d.total, d.loc)}</td></tr></table>
  <div class="box">${d.payment}</div></body></html>`;
}

const NO = { no: 'Fakturanr.', date: 'Fakturadato', due: 'Forfallsdato', to: 'Kunde', desc: 'Beskrivelse', qty: 'Antall', price: 'Pris', amount: 'Beløp', sub: 'Sum eks. MVA', tax: 'MVA 25 %', total: 'Å betale' };
const EN = { no: 'Invoice no.', date: 'Invoice date', due: 'Due date', to: 'Bill to', desc: 'Description', qty: 'Qty', price: 'Unit price', amount: 'Amount', sub: 'Subtotal', tax: 'VAT 21%', total: 'Total' };

const samples = [
  {
    file: '01-clean-nok-invoice.pdf', note: 'expected: auto_approved',
    vendor: 'Fjordlys Kontorrekvisita AS', vendorInfo: 'Org.nr. 999 100 001 MVA · Eksempelgata 12, 9008 Tromsø',
    title: 'FAKTURA', number: '2026-0412', date: '01.10.2026', due: '15.10.2026', labels: NO, loc: 'nb-NO', cur: 'NOK',
    customer: 'Acme Studio AS, Nordreisa',
    lines: [['Kontorstol Ergo Pro', 2, 1500, 3000], ['Skrivebordslampe LED', 4, 200, 800], ['Frakt', 1, 200, 200]],
    sub: 4000, tax: 1000, total: 5000, payment: 'Kontonr. 1234.56.78903 · KID 0004120263',
  },
  {
    file: '02-math-error-eur-invoice.pdf', note: 'expected: needs_review (line 2 qty × price wrong, total wrong)',
    vendor: 'Brightline Studio B.V.', vendorInfo: 'VAT NL812345678B01 · Example Street 100, Amsterdam',
    title: 'INVOICE', number: 'BL-1187', date: '03.10.2026', due: '02.11.2026', labels: EN, loc: 'en-GB', cur: 'EUR',
    customer: 'Acme Studio AS, Norway',
    lines: [['Brand guidelines', 1, 1200, 1200], ['Logo variations', 3, 150, 500], ['Social templates', 10, 25, 250]],
    sub: 1950, tax: 409.5, total: 2395.5, payment: 'IBAN NL91 ABNA 0417 1643 00 · Ref BL-1187',
  },
  {
    file: '03-above-limit-invoice.pdf', note: 'expected: needs_review (above approval limit)',
    vendor: 'Arktisk Serverdrift AS', vendorInfo: 'Org.nr. 999 100 002 MVA · Testveien 4, 8006 Bodø',
    title: 'FAKTURA', number: 'NS-5521', date: '05.10.2026', due: '04.11.2026', labels: NO, loc: 'nb-NO', cur: 'NOK',
    customer: 'Acme Studio AS, Nordreisa',
    lines: [['Server rack 2U', 1, 28000, 28000], ['Installasjon', 8, 1000, 8000]],
    sub: 36000, tax: 9000, total: 45000, payment: 'Kontonr. 9876.54.32109 · KID 5521000123',
  },
];

const receipt = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff;font-family:"DejaVu Sans Mono",monospace;font-size:15px;color:#222}
  .r{width:360px;padding:26px 24px} .c{text-align:center} .row{display:flex;justify-content:space-between}
  hr{border:none;border-top:1px dashed #555;margin:10px 0}</style></head><body><div class="r">
  <div class="c"><b>KAFFEBAR POLARHAVET</b><br>Org.nr 999 100 003 MVA<br>Demogata 7, Tromsø</div><hr>
  <div>Kvittering 88213<br>12.10.2026 09:41</div><hr>
  <div class="row"><span>2 x Cappuccino 52,00</span><span>104,00</span></div>
  <div class="row"><span>1 x Kanelbolle</span><span>45,00</span></div><hr>
  <div class="row"><span>Sum eks. MVA</span><span>132,44</span></div>
  <div class="row"><span>MVA 12,5 %</span><span>16,56</span></div>
  <div class="row"><b>TOTAL NOK</b><b>149,00</b></div><hr>
  <div class="c">Bankkort ****1234<br>Takk for besøket!</div></div></body></html>`;

(async () => {
  const out = path.join(__dirname, '..', 'samples');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const s of samples) {
    await page.setContent(invoiceHtml(s));
    await page.pdf({ path: path.join(out, s.file), format: 'A4', printBackground: true });
    console.log(s.file, '—', s.note);
  }
  await page.setViewportSize({ width: 408, height: 520 });
  await page.setContent(receipt);
  await page.screenshot({ path: path.join(out, '04-cafe-receipt.jpg'), type: 'jpeg', quality: 85, fullPage: true });
  console.log('04-cafe-receipt.jpg — expected: auto_approved (receipt)');
  await browser.close();
})();
