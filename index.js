'use strict';

// Zero-dependency GitHub Action: merges per-workspace nyc coverage in a monorepo
// and posts the totals as a pull request comment. Runs on the node24 runtime and
// uses only Node built-ins, so there is no bundle to build and nothing to audit.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MARKER = '<!-- monorepo-coverage-action -->';
const METRICS = ['lines', 'statements', 'functions', 'branches'];
const API = process.env.GITHUB_API_URL || 'https://api.github.com';

const readInput = (name, fallback = '') => {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/ /g, '_')}`];
  return (value === undefined || value === '' ? fallback : value).trim();
};

const escape = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const log = (message) => process.stdout.write(`${message}\n`);
const warn = (message) => log(`::warning::${escape(message)}`);
const fail = (message) => {
  log(`::error::${escape(message)}`);
  process.exitCode = 1;
};

const setOutput = (name, value) => {
  const file = process.env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `${name}=${value}\n`);
};

// Copy every <folder>/<workspace>/coverage/coverage-final.json into .nyc_output,
// rewriting the container-absolute paths some runners produce so nyc can resolve
// the sources. Returns the workspace names that contributed coverage.
const mergeCoverage = (folders) => {
  fs.mkdirSync('.nyc_output', { recursive: true });
  const merged = [];

  for (const folder of folders) {
    let entries;
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      log(`No such directory: ${folder} — skipping.`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const source = path.join(folder, entry.name, 'coverage', 'coverage-final.json');
      if (!fs.existsSync(source)) continue;

      const contents = fs.readFileSync(source, 'utf8').split('/github/workspace').join('.');
      fs.writeFileSync(path.join('.nyc_output', `${entry.name}.json`), contents);
      merged.push(entry.name);
      log(`Merged coverage for ${entry.name}`);
    }
  }

  return merged;
};

const runReport = (command) => {
  const [bin, ...args] = command.split(/\s+/).filter(Boolean);
  execFileSync(bin, args, { stdio: 'inherit' });
};

const table = (title, total) => [
  MARKER,
  `## ${title}`,
  '',
  '| Metric | % | Covered/Total |',
  '| --- | --- | --- |',
  ...METRICS.map((metric) => {
    const m = total[metric] || {};
    return `| ${metric[0].toUpperCase()}${metric.slice(1)} | ${m.pct ?? '—'}% | ${m.covered ?? '—'}/${m.total ?? '—'} |`;
  }),
].join('\n');

// The pull request number comes from the input first: workflow_dispatch runs have
// no pull request in their event payload, which is the case this action exists to
// handle. The payload is only a fallback for pull_request / issue_comment runs.
const resolvePullRequest = () => {
  const fromInput = Number(readInput('pr-number'));
  if (fromInput) return fromInput;

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return 0;

  try {
    const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    return Number(payload.pull_request?.number || payload.issue?.number || 0);
  } catch {
    return 0;
  }
};

const request = async (method, url, token, body) => {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'monorepo-coverage-action',
      'x-github-api-version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${method} ${url} responded ${response.status} ${response.statusText}`);
  }
  return response.json();
};

// Reuse this action's previous comment when sticky, so a pull request that runs
// CI repeatedly ends up with one up to date comment instead of a pile of them.
const findPreviousComment = async (repo, prNumber, token) => {
  const comments = await request(
    'GET',
    `${API}/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
    token,
  );
  return comments.find((comment) => comment.body && comment.body.includes(MARKER));
};

const postComment = async (body, prNumber, token, sticky) => {
  const repo = process.env.GITHUB_REPOSITORY;

  if (sticky) {
    const previous = await findPreviousComment(repo, prNumber, token);
    if (previous) {
      const updated = await request('PATCH', `${API}/repos/${repo}/issues/comments/${previous.id}`, token, { body });
      return updated.html_url;
    }
  }

  const created = await request('POST', `${API}/repos/${repo}/issues/${prNumber}/comments`, token, { body });
  return created.html_url;
};

const main = async () => {
  const workingDirectory = readInput('working-directory', '.');
  if (workingDirectory !== '.') process.chdir(workingDirectory);

  const folders = readInput('folders', 'packages,services,facades')
    .split(',')
    .map((folder) => folder.trim())
    .filter(Boolean);

  const merged = mergeCoverage(folders);
  setOutput('workspaces', merged.length);
  if (!merged.length) {
    warn(`No coverage-final.json found under ${folders.join(', ')} — nothing to report.`);
    setOutput('comment-url', '');
    return;
  }

  runReport(readInput('report-command', 'npx nyc report --reporter json-summary'));

  const summaryPath = readInput('summary-path', 'coverage/coverage-summary.json');
  if (!fs.existsSync(summaryPath)) {
    warn(`${summaryPath} was not written — skipping the coverage comment.`);
    setOutput('comment-url', '');
    return;
  }

  const { total } = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  for (const metric of METRICS) setOutput(metric, total[metric]?.pct ?? '');

  const prNumber = resolvePullRequest();
  if (!prNumber) {
    warn('No pull request number — pass pr-number when running via workflow_dispatch. Skipping the comment.');
    setOutput('comment-url', '');
    return;
  }

  const token = readInput('token');
  if (!token) {
    warn('No token — skipping the coverage comment.');
    setOutput('comment-url', '');
    return;
  }

  // A comment is cosmetic: never fail a green build because posting it did not work.
  try {
    const url = await postComment(
      table(readInput('title', 'Coverage report'), total),
      prNumber,
      token,
      readInput('sticky', 'true') !== 'false',
    );
    setOutput('comment-url', url);
    log(`Coverage comment: ${url}`);
  } catch (error) {
    warn(`Could not post the coverage comment: ${error.message}`);
    setOutput('comment-url', '');
  }
};

main().catch((error) => fail(error.stack || error.message));
