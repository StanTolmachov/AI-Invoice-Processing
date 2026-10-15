// ---- Node: "Validate & route" (Code, run once for all items) ----
// Parses Gemini output, runs arithmetic and business checks, flags duplicates,
// and decides: auto_approved | needs_review | skipped. A failed AI call becomes
// needs_review instead of disappearing.

const staticData = $getWorkflowStaticData('global');
staticData.invoices = staticData.invoices || {};
const prepared = $('Prepare Gemini request').all();

const out = [];
$input.all().forEach((item, i) => {
  const src = prepared[i];
  const meta = { ...src.json };
  delete meta.geminiBody;
  meta.processedAt = new Date().toISOString();

  let result;
  try {
    if (item.json.error) {
      const e = item.json.error;
      throw new Error(typeof e === 'string' ? e : (e.message || JSON.stringify(e)).slice(0, 300));
    }
    result = validateInvoice(parseGeminiResponse(item.json));
  } catch (err) {
    result = {
      invoice: validateInvoice({ document_type: 'invoice' }).invoice,
      flags: ['extraction failed: ' + err.message],
      status: 'needs_review',
    };
  }

  const { invoice } = result;
  const flags = result.flags.slice();
  let status = result.status;

  const key = invoiceKey(invoice);
  if (status !== 'skipped' && key && !rememberKey(staticData.invoices, key, meta.processedAt)) {
    flags.push('possible duplicate invoice');
    status = 'needs_review';
  }

  meta.archiveName = archiveFileName(invoice, meta.fileName);
  out.push({
    json: {
      ...toSheetRow(meta, invoice, flags, status),
      _status: status,
      _flags: flags,
      _lines: invoice.line_items,
    },
    binary: src.binary,
  });
});
return out;
