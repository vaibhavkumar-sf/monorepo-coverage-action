// Stand-in for `npx nyc report` in tests: turns .nyc_output into a summary file.
const fs = require('fs');
const files = fs.readdirSync('.nyc_output');
const n = files.length;
fs.mkdirSync('coverage', { recursive: true });
fs.writeFileSync('coverage/coverage-summary.json', JSON.stringify({
  total: {
    lines: { total: 100 * n, covered: 93 * n, pct: 93 },
    statements: { total: 100 * n, covered: 91 * n, pct: 91 },
    functions: { total: 50 * n, covered: 44 * n, pct: 88 },
    branches: { total: 40 * n, covered: 30 * n, pct: 75 },
  },
}));
