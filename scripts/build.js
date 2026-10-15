// Builds workflows/*.json from workflows/src/*.json by inlining code/lib + code/nodes
// into the Code nodes. The code that is tested is exactly the code that ships.
//   node scripts/build.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lib = fs.readFileSync(path.join(root, 'code/lib/invoice.js'), 'utf8');

/** Code node source = shared lib + node-specific glue. */
function nodeCode(file) {
  const glue = fs.readFileSync(path.join(root, 'code/nodes', file), 'utf8');
  return file === 'add-drive-link.js' ? glue : lib + '\n' + glue;
}

function build() {
const srcDir = path.join(root, 'workflows/src');
for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith('.json'))) {
  const wf = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'));
  for (const node of wf.nodes) {
    const ref = node.parameters && node.parameters.jsCode;
    if (typeof ref === 'string' && ref.startsWith('@file:')) {
      node.parameters.jsCode = nodeCode(ref.slice(6));
    }
  }
  fs.writeFileSync(path.join(root, 'workflows', f), JSON.stringify(wf, null, 2) + '\n');
  console.log('built workflows/' + f);
}
}

if (require.main === module) build();
module.exports = { nodeCode };
