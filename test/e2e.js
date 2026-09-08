// End-to-end test with no network and no dependencies: a local stub of the
// GitHub REST API stands in for github.com, so the comment path is exercised
// for real, including the sticky update.
const assert = require('node:assert');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run_ = promisify(execFile);
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-action-'));
const comments = [];

for (const [folder, name] of [['packages', 'core'], ['services', 'auth-service'], ['facades', 'web-facade']]) {
  const dir = path.join(workspace, folder, name, 'coverage');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'coverage-final.json'),
    '{"/github/workspace/src/a.ts":{"path":"/github/workspace/src/a.ts"}}');
}
fs.mkdirSync(path.join(workspace, 'services', 'no-tests-service'), { recursive: true });

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify(comments));
    if (req.method === 'POST') {
      const comment = { id: comments.length + 1, body: JSON.parse(body).body, html_url: `http://stub/comment/${comments.length + 1}` };
      comments.push(comment);
      return res.end(JSON.stringify(comment));
    }
    const id = Number(req.url.split('/').pop());
    const existing = comments.find((c) => c.id === id);
    existing.body = JSON.parse(body).body;
    return res.end(JSON.stringify(existing));
  });
});

const run = async (extraEnv = {}) => {
  const outputFile = path.join(workspace, `output-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(outputFile, '');
  const { stdout } = await run_(process.execPath, [path.join(root, 'index.js')], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputFile,
      GITHUB_REPOSITORY: 'octo/repo',
      GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
      GITHUB_EVENT_PATH: '',
      'INPUT_TOKEN': 'stub-token',
      'INPUT_PR-NUMBER': '42',
      'INPUT_FOLDERS': 'packages,services,facades',
      'INPUT_REPORT-COMMAND': `${process.execPath} ${path.join(root, 'test', 'fake-nyc.js')}`,
      ...extraEnv,
    },
  });
  const outputs = Object.fromEntries(
    fs.readFileSync(outputFile, 'utf8').split('\n').filter(Boolean).map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
  );
  return { stdout, outputs };
};

server.listen(0, '127.0.0.1', async () => {
  // 1. merges only workspaces that produced coverage, and posts one comment
  const first = await run();
  assert.strictEqual(first.outputs.workspaces, '3', 'should merge exactly the three workspaces with coverage');
  assert.strictEqual(first.outputs.lines, '93');
  assert.strictEqual(comments.length, 1, 'should create one comment');
  assert.match(comments[0].body, /## Coverage report/);
  assert.match(comments[0].body, /\| Lines \| 93% \| 279\/300 \|/);

  // 2. container-absolute paths are rewritten so nyc can resolve sources
  const merged = fs.readFileSync(path.join(workspace, '.nyc_output', 'core.json'), 'utf8');
  assert.ok(!merged.includes('/github/workspace'), 'should rewrite /github/workspace');

  // 3. sticky: a second run updates that comment instead of adding another
  const second = await run({ 'INPUT_TITLE': 'Coverage report (rerun)' });
  assert.strictEqual(comments.length, 1, 'sticky should update, not duplicate');
  assert.match(comments[0].body, /## Coverage report \(rerun\)/);
  assert.strictEqual(second.outputs['comment-url'], 'http://stub/comment/1');

  // 4. sticky disabled adds a second comment
  await run({ 'INPUT_STICKY': 'false' });
  assert.strictEqual(comments.length, 2, 'sticky:false should create a new comment');

  // 5. no pull request number: warn and skip, never fail
  const withoutPr = await run({ 'INPUT_PR-NUMBER': '' });
  assert.match(withoutPr.stdout, /::warning::No pull request number/);
  assert.strictEqual(comments.length, 2, 'should not comment without a pull request');

  // 6. nothing to report: warn and skip
  const empty = await run({ 'INPUT_FOLDERS': 'does-not-exist' });
  assert.match(empty.stdout, /::warning::No coverage-final.json found/);
  assert.strictEqual(empty.outputs.workspaces, '0');

  console.log('all assertions passed');
  server.close();
});
