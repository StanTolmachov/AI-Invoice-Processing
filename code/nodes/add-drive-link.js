// ---- Node: "Add Drive link" (Code, run once for each item) ----
// Google Drive upload returns file metadata; merge it back into the row for Sheets.

const row = $('Validate & route').item.json;
return {
  json: {
    ...row,
    'File Link': $json.id ? `https://drive.google.com/file/d/${$json.id}/view` : '',
  },
};
