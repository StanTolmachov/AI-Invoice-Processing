// Structural checks on the built workflow JSON files (run `npm run build` first).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const dir = path.join(__dirname, '..', 'workflows');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const wf = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const names = new Set(wf.nodes.map((n) => n.name));

  test(`${file}: unique node names and ids`, () => {
    assert.strictEqual(names.size, wf.nodes.length);
    assert.strictEqual(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length);
  });

  test(`${file}: every connection points to an existing node`, () => {
    for (const [from, conn] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), 'unknown source ' + from);
      for (const branch of conn.main) for (const c of branch) assert.ok(names.has(c.node), 'unknown target ' + c.node);
    }
  });

  test(`${file}: every working node is reachable from the trigger`, () => {
    const trigger = wf.nodes.find((n) => /Trigger$/i.test(n.type));
    assert.ok(trigger, 'no trigger');
    const seen = new Set([trigger.name]);
    const queue = [trigger.name];
    while (queue.length) {
      const n = queue.shift();
      for (const branch of (wf.connections[n] || { main: [] }).main) {
        for (const c of branch) if (!seen.has(c.node)) { seen.add(c.node); queue.push(c.node); }
      }
    }
    const orphans = wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote' && !seen.has(n.name));
    assert.deepStrictEqual(orphans.map((n) => n.name), []);
  });

  test(`${file}: Code nodes are inlined and compile`, () => {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      assert.ok(!n.parameters.jsCode.startsWith('@file:'), n.name + ' not built');
      assert.doesNotThrow(() => new AsyncFunction('$input', '$', '$json', '$getWorkflowStaticData', n.parameters.jsCode), n.name);
    }
  });

  test(`${file}: no secrets or credentials embedded`, () => {
    const raw = JSON.stringify(wf);
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(raw), 'Google API key found');
    assert.ok(!/xox[bp]-/.test(raw), 'Slack token found');
    assert.ok(!wf.nodes.some((n) => n.credentials), 'credentials must be attached by the user');
  });

  test(`${file}: node names referenced in expressions exist`, () => {
    const raw = JSON.stringify(wf);
    for (const m of raw.matchAll(/\$\(\\?['"]([^'"\\]+)\\?['"]\)/g)) assert.ok(names.has(m[1]), 'missing ' + m[1]);
  });
}
