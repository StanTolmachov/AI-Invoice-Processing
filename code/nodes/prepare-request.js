// ---- Node: "Prepare Gemini request" (Code, run once for all items) ----
// Builds the Gemini request body: prompt + file as inline base64 + strict JSON schema.

const items = $input.all();
const out = [];
for (let i = 0; i < items.length; i++) {
  const buffer = await this.helpers.getBinaryDataBuffer(i, 'data');
  if (buffer.length > CONFIG.MAX_FILE_BYTES) {
    console.log(`Skipped ${items[i].json.fileName}: ${buffer.length} bytes is over the limit`);
    continue;
  }
  out.push({
    json: {
      ...items[i].json,
      geminiBody: buildGeminiBody(buffer.toString('base64'), items[i].json.mimeType),
    },
    binary: items[i].binary,
  });
}
return out;
