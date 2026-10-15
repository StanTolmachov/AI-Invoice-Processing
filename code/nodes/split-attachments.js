// ---- Node: "Split attachments" (Code, run once for all items) ----
// One item per supported attachment. Skips files already processed (workflow static data,
// persisted in production runs only — manual test runs always process).

const staticData = $getWorkflowStaticData('global');
staticData.files = staticData.files || {};

const out = [];
for (const item of $input.all()) {
  const j = item.json || {};
  const messageId = j.id || j.messageId || '';
  const from = (j.from && j.from.value && j.from.value[0] && j.from.value[0].address) ||
    (j.from && j.from.text) || j.From || '';
  const subject = j.subject || j.Subject || '';

  for (const bin of Object.values(item.binary || {})) {
    if (!CONFIG.ALLOWED_MIME.includes(bin.mimeType)) continue;
    const dedupeKey = `${messageId}:${bin.fileName}`;
    if (!rememberKey(staticData.files, dedupeKey, Date.now())) continue;

    out.push({
      json: {
        messageId,
        from,
        subject,
        receivedAt: j.date || new Date().toISOString(),
        fileName: bin.fileName || 'attachment',
        mimeType: bin.mimeType,
      },
      binary: { data: bin },
    });
  }
}
return out;
