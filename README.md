# monorepo-coverage-action

[![test](https://github.com/vaibhavkumar-sf/monorepo-coverage-action/actions/workflows/test.yml/badge.svg)](https://github.com/vaibhavkumar-sf/monorepo-coverage-action/actions/workflows/test.yml)

Merges per-workspace [nyc](https://github.com/istanbuljs/nyc) coverage in a monorepo and posts the totals as a pull request comment.

- **Works on `workflow_dispatch` runs.** The pull request can be passed as an input, so the action does not depend on a `pull_request` event payload being present.
- **Sticky comments.** Repeated runs update one comment instead of leaving a trail.
- **Never fails a green build.** A comment that cannot be posted is a warning, not a failed step.
- **No dependencies.** A single file on the `node24` runtime using only Node built-ins — nothing to bundle, nothing to audit.

## Usage

```yaml
- name: Coverage report
  uses: vaibhavkumar-sf/monorepo-coverage-action@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    pr-number: ${{ steps.resolve.outputs.number }}   # required on workflow_dispatch runs
```

The job needs `pull-requests: write` to comment.

### Inputs

| Input | Default | Description |
| --- | --- | --- |
| `token` | — (required) | Token used to read and write comments. Usually `secrets.GITHUB_TOKEN`. |
| `pr-number` | event payload | Pull request to comment on. Required for `workflow_dispatch` runs. |
| `folders` | `packages,services,facades` | Comma separated directories to scan for workspaces. |
| `working-directory` | `.` | Directory to run in. |
| `report-command` | `npx nyc report --reporter json-summary` | Command that writes the summary from `.nyc_output`. |
| `summary-path` | `coverage/coverage-summary.json` | Path of the summary written by `report-command`. |
| `title` | `Coverage report` | Heading of the comment. |
| `sticky` | `true` | Update the previous comment instead of adding a new one. |

### Outputs

`lines`, `statements`, `functions`, `branches` (percentages), `workspaces` (count merged), `comment-url`.

## What it does

1. Copies every `<folder>/<workspace>/coverage/coverage-final.json` into `.nyc_output/<workspace>.json`, rewriting `/github/workspace` paths so nyc can resolve sources.
2. Runs `report-command` to produce a single summary.
3. Posts the totals on the pull request, updating its own previous comment when `sticky` is on.

## Migrating from `akshatdubeysf/lerna-monorepo-coverage-action`

That action reads the pull request from `context.issue.number`, so it fails with `HttpError: Not Found` on `workflow_dispatch` runs, and it calls `core.setFailed` when the comment cannot be posted — turning a cosmetic problem into a red check. It also targets the `node16` runtime, which current runners warn about.

```diff
-      - uses: akshatdubeysf/lerna-monorepo-coverage-action@v4.5
-        with:
-          token: ${{ secrets.GITHUB_TOKEN }}
+      - uses: vaibhavkumar-sf/monorepo-coverage-action@v1
+        with:
+          token: ${{ secrets.GITHUB_TOKEN }}
+          pr-number: ${{ steps.resolve.outputs.number }}
```

`folders` keeps the same meaning and default.

> Note: a step-level `env: GITHUB_EVENT_PATH` does **not** work as a substitute — the runner keeps the default `GITHUB_*` variables for an action's process, so the action still reads the real event payload. Passing the number as an input is the supported route.

## Development

```bash
node test/e2e.js     # end-to-end, no network: a local stub stands in for the REST API
```

## License

MIT
