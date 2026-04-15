# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## GitHub Actions: SHA Pinning (Mandatory)

All GitHub Actions MUST use commit SHA references, never version tags or branch references. This is a supply chain security requirement to prevent tag-based attacks and ensure reproducible CI/CD pipelines.

### Correct — SHA-pinned with version tag comment

```yaml
- uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1
- uses: actions/setup-node@60edb5dd545a775178f52524783378180af0d1f8 # v4.0.2
```

Note: npm is included with Node.js, so no additional setup action is required.

### Wrong — tag or branch reference (not allowed)

```yaml
# Never use tags
- uses: actions/checkout@v4
- uses: actions/setup-node@v4

# Never use branches
- uses: actions/checkout@main
```

**How to find the SHA:** Use GitHub's action lookup tool or check the action's release page for the commit SHA of your desired version. Always include the version tag as a comment for readability.

---

## Monorepo Structure

Three npm workspaces in `packages/` (defined via `"workspaces": ["packages/*"]` in root `package.json`):

- **`@mctx-ai/app`** (`packages/server/`) — Core framework. Zero runtime dependencies. Exports `createServer`, `T`, `conversation`, `createProgress`, `PROGRESS_DEFAULTS`, `log`, `buildInputSchema`, `getLogBuffer`, `clearLogBuffer`, `createEmit`, `META_KEY_PATTERN`. Type exports include `ModelContext` (`{ userId?: string, emit: EmitFunction }`). Build is a simple `cp src/*.js src/*.d.ts dist/` (no transpilation).
- **`@mctx-ai/dev`** (`packages/dev/`) — Dev server with hot reload, request logging, log surfacing (handler log entries printed to dev console), and sampling stub (`/_mctx/sampling` endpoint returns error in dev mode). Peer-depends on `@mctx-ai/app`. Uses Node.js built-in test runner (`node --test`), not Vitest. Lint is a stub (`echo 'Linting not configured yet'`).
- **`create-mctx-app`** (`packages/create-mctx-app/`) — CLI scaffolding tool (`npm create mctx-app <name>`). Generates a new project with `@mctx-ai/app` + `@mctx-ai/dev` + `esbuild` configured.

Root commands affect all workspaces. Use `--workspace` flag for package-specific operations.

**Requires:** Node >=22.0.0, npm >=10.8.0 (enforced in root `package.json` `engines` field).

**`.npmrc`:** `save-exact=true` — all dependencies installed with exact versions (no `^` or `~` ranges).

---

## Development Commands

### Root (all packages)

```bash
npm run build          # Build all packages
npm test              # Run all tests
npm run lint          # Lint all packages
npm run format        # Format with Prettier
npm run format:check  # Check formatting without modifying
```

### Server Package

```bash
# Testing
npm run test --workspace=@mctx-ai/app
npm run test:coverage --workspace=@mctx-ai/app  # V8 coverage, 80% thresholds
npx vitest run test/uri.test.js                        # Single test file (from packages/server/)
npx vitest run -t "test name"                          # Specific test by name

# Code quality
npm run lint --workspace=@mctx-ai/app
npm run lint:fix --workspace=@mctx-ai/app
npm run typecheck --workspace=@mctx-ai/app  # tsc --noEmit
```

---

## Code Conventions

### Language and Typing

- **JavaScript with ESM** — No TypeScript source files. All packages use `"type": "module"`.
- **Type definitions** — Hand-written `.d.ts` files (see `packages/server/src/index.d.ts`, 770+ lines).
- **JSDoc** — Inline documentation in JS source, exported types in `.d.ts`.

### Naming Conventions

- **Functions and variables:** `camelCase`
- **Constants:** `UPPER_SNAKE_CASE`
- **Types (in `.d.ts`):** `PascalCase`
- **Unused parameters:** `_` prefix (e.g., `function handler(_req, res)`)

### Linting

- **ESLint 9** with flat config (`eslint.config.js`)
- **Key rule:** `no-unused-vars` with `argsIgnorePattern: "^_"` — prefix unused params with underscore

### Formatting

- **Prettier 3** for `.js`, `.json`, `.md` files (`printWidth: 100` in `.prettierrc.json`)
- Run `npm run format` before committing

---

## Architecture Patterns

### Handler Descriptor Pattern

Functions carry metadata as properties:

```javascript
function greet({ name }) {
  return `Hello, ${name}!`;
}
greet.description = "Greet someone by name";
greet.input = { name: T.string({ required: true }) };

app.tool("greet", greet);
```

Handler functions receive up to three parameters: `(mctx, args, ask)` for tools and prompts, `(mctx, params, ask)` for resource templates. All parameters are optional. `mctx` is an `ModelContext` object `{ userId?: string }` populated automatically by the platform.

### Handler Types

1. **Tools** — Sync, async, or generator functions. Generators yield progress notifications. `ask` (third param) enables LLM sampling. `mctx` (first param) carries per-request context including `mctx.userId`.
2. **Resources** — Static URIs or URI templates with `{param}` placeholders. Params extracted via RFC 6570 Level 1. Template handlers receive `(mctx, params, ask)`.
3. **Prompts** — Return string, `conversation()` result, or Message array. Receive `(mctx, args, ask)`.

`ModelContext` shape: `{ userId?: string, emit: EmitFunction, cancel: CancelFunction }`. `mctx.userId` is a stable, opaque identifier for the authenticated user extracted from the `X-Mctx-User-Id` HTTP header injected by the mctx dispatch worker. It is `undefined` for unauthenticated requests.

### Channel Events

`mctx.emit(content, options?)` and `mctx.cancel(eventId)` are available in all handler types (tools, resources, prompts) via the `mctx` parameter. Events are written as `X-Mctx-Event` response headers; the dispatch worker reads these headers and writes events to D1. No HTTP calls, env vars, or async coordination required.

**Emit signature:**

```javascript
mctx.emit(content, options?)
```

**Parameters:**

- `content` (string) — Display text for the event, non-empty, truncated to 500 characters
- `options` (object, optional) — Event configuration
  - `options.eventType` (string) — Custom event type identifier (default: `"channel"`), must match `[a-zA-Z0-9_]+`
  - `options.meta` (object) — Key-value metadata; both keys and values must be strings and keys must match `[a-zA-Z0-9_]+`
  - `options.deliverAt` (string) — ISO 8601 timestamp for scheduled delivery; omit for immediate delivery
  - `options.key` (string) — Idempotency/correlation key for deduplication and cancellation, must match `[a-zA-Z0-9_]+`

**Returns:** `string` — the eventId (UUID) synchronously, or `""` on silent no-op

**Cancel signature:**

```javascript
mctx.cancel(eventId);
```

- `eventId` (string) — the eventId returned by a previous `mctx.emit()` call
- Appends an `X-Mctx-Cancel` response header; the dispatch worker cancels the matching pending event in D1
- No-ops silently on invalid input

**Behavior:**

- No-ops silently on invalid input (wrong types, empty strings, invalid key/meta patterns)
- Content automatically truncated to 500 characters
- Any metadata key or value violation triggers a silent no-op (no event emitted)
- `expiresAt` set automatically to 7 days from emit time; cannot be overridden
- Synchronous and non-blocking — no async, no awaiting, no side effects on the tool response

**Important:** Developers MUST sanitize user-generated content before passing to `mctx.emit()`. The emit function does not perform content sanitization beyond length truncation.

**Example:**

```javascript
function myTool(mctx, { userId, scheduleFor }, _ask) {
  // ... do work ...

  // Sanitize user input before emitting
  const sanitizedMessage = sanitize(userInput);

  // Emit immediately and capture the eventId for possible cancellation
  const eventId = mctx.emit(`User ${userId} completed task`, {
    eventType: "task_complete",
    meta: { user_id: userId, status: "success" },
  });

  // Emit a scheduled follow-up notification
  const reminderEventId = mctx.emit("Reminder: review your results", {
    eventType: "reminder",
    deliverAt: scheduleFor,
    key: `reminder_${userId}`,
  });

  // Cancel a previously scheduled event if needed
  if (shouldCancel) {
    mctx.cancel(reminderEventId);
  }

  return { success: true, eventId };
}
```

### Core Modules

- **`server.js`** — JSON-RPC 2.0 routing, capability negotiation, handler dispatch
- **`types.js`** — `T` type system (T.string, T.number, T.boolean, T.array, T.object) compiles to JSON Schema
- **`uri.js`** — RFC 6570 Level 1 URI template matching
- **`conversation.js`** — Multi-message prompt builder (user.say, ai.say, attach, embed)
- **`progress.js`** — Generator-based progress with 60s timeout, 10k yield limit
- **`log.js`** — RFC 5424 logging (8 severity levels, internal buffer with FIFO eviction)
- **`sampling.js`** — LLM-in-the-loop via `ask` function (client sampling capability)
- **`completion.js`** — Auto-completion from handlers, T.enum, or URI templates
- **`security.js`** — Error sanitization, secret redaction, size limits, URI scheme validation
- **`channel.js`** — Channel event emission (createEmit, createCancel, response header event emission)

---

## Git Conventions

### Commit Messages

**Format:** Conventional Commits (`type(scope): description`)

**Types that trigger releases:**

- `feat(scope):` → Minor version bump
- `fix(scope):` → Patch version bump
- `perf(scope):` → Patch version bump
- `revert(scope):` → Patch version bump
- `docs(scope):` → Patch version bump
- `style(scope):` → Patch version bump

**Types that don't trigger releases:**

- `chore:`, `ci:`, `test:`, `refactor:`, `build:`

### DCO Requirement

All commits MUST be signed off:

```bash
git commit -s -m "feat(server): add URI template validation"
```

This adds `Signed-off-by: Your Name <your.email@example.com>` to the commit message. DCO is enforced by convention and code review — there is no automated enforcement via GitHub App or commit hook.

### Merge Strategy

PRs are **squash merged**. The PR title becomes the commit subject and the PR description becomes the commit body. PR titles are validated by CI against Conventional Commits format (see CI/CD section).

### Hooks and Automation

A pre-push git hook runs quality checks before any push. It is stored in `.githooks/pre-push` (tracked in the repo) and runs:

1. `npm run format:check` — Prettier formatting check
2. `npm run lint` — ESLint across all workspaces
3. `npm test` — Full test suite across all workspaces

**Installation:** Run `npm install` (or `npm run prepare`) once after cloning. The `prepare` script in root `package.json` sets `core.hooksPath` to `.githooks` via `git config core.hooksPath .githooks`.

There are no commit hooks (no husky, no lint-staged). The pre-push hook is the only local quality gate; all checks also run in CI.

---

## Testing

### Framework and Coverage

- **Vitest v4** with V8 coverage provider
- **Thresholds:** 80% minimum for lines, functions, branches, statements

### Running Tests

```bash
# All tests
npm test

# Single package
npm run test --workspace=@mctx-ai/app

# With coverage report
npm run test:coverage --workspace=@mctx-ai/app

# Single test file
npx vitest run test/uri.test.js

# Single test by name
npx vitest run -t "validates URI templates correctly"
```

---

## Releases

**Automated via `multi-semantic-release`** (specifically `@anolilab/multi-semantic-release`) for independent monorepo package releases.

### Release Pipeline

1. **Trigger:** Push to `main` branch
2. **CI gate:** Build, lint, test, and smoke test all three packages must pass first
3. **Release:** `multi-semantic-release` analyzes commits, bumps versions, publishes to npm, creates GitHub releases
4. **Post-publish check:** Waits 30s then runs `npm install @mctx-ai/app@latest --dry-run` to verify npm propagation

**Concurrency:** Only one release runs at a time (`concurrency: { group: release, cancel-in-progress: false }`).

### Release Configuration

Single `.releaserc.json` at root (no per-package configs). Plugin chain:

1. `@semantic-release/commit-analyzer` — Determines version bump from commit type (preset: `conventionalcommits`)
2. `@semantic-release/release-notes-generator` — Generates changelog (preset: `conventionalcommits`)
3. `@semantic-release/npm` — Publishes to npm registry
4. `@semantic-release/github` — Creates GitHub release with release notes

**Release rules:** `feat` → minor, `fix`/`perf`/`revert`/`docs`/`style` → patch. Other types (`chore`, `ci`, `test`, `refactor`, `build`) do not trigger releases. `BREAKING CHANGE` in commit body or `!` suffix (e.g., `feat!:`) triggers a major release.

No manual version bumps or changelog edits required.

### OIDC Trusted Publishing (npm)

npm publishing uses **OIDC trusted publishing** — no `NPM_TOKEN` secret exists or is needed. The flow:

1. Each package's `publishConfig` includes `"provenance": true`
2. The release workflow job has `permissions: { id-token: write }` to request an OIDC token
3. The workflow upgrades npm to `11.10.0` (which supports OIDC authentication)
4. During `npm publish`, npm requests an OIDC token from GitHub Actions
5. npm sends the token to the npm registry, which verifies the GitHub Actions identity
6. The registry validates the token against the **trusted publisher configuration** on npmjs.com (configured per-package on the npmjs.com website — not in this repo)
7. The package is published with a **provenance attestation** linking the published artifact to the specific GitHub Actions workflow run

**What this means:** No secrets to rotate, no token to leak. Publishing is cryptographically tied to a specific GitHub repo + workflow + branch. The provenance attestation is publicly visible on npmjs.com for each published version.

---

## CI/CD

Five GitHub Actions workflows:

### `ci.yml` — Continuous Integration

Trigger: push/PR to `main`. Four jobs:

1. **`lint`** — ESLint, Prettier format check, TypeScript type check (`tsc --noEmit`), workspace validation
2. **`test`** — Matrix: Node `22.x` × ubuntu/windows/macos (fail-fast disabled). Coverage uploaded as artifact for ubuntu (retained 7 days)
3. **`security`** — `npm audit --audit-level=high --omit=dev` (dev deps excluded) + license check (`license-checker`, fails on GPL/AGPL)
4. **`scaffold`** — Builds packages, runs `create-mctx-app` to generate a test project, validates generated `package.json` fields

### `release.yml` — Automated Release

Trigger: push to `main`. See [Releases](#releases) section for full details. Three sequential jobs: ci-gate → release → post-publish-check.

### `pr-title.yml` — PR Title Validation

Trigger: PR opened/edited/synchronized/reopened to `main`. Validates PR title against Conventional Commits format using `amannn/action-semantic-pull-request`. Allowed types: `feat`, `fix`, `perf`, `revert`, `docs`, `chore`, `ci`, `test`, `refactor`, `style`, `build`. No length restriction.

### `pr-comment.yml` — PR Bot Comment

Trigger: PR opened. Posts squash merge workflow instructions (how commit types map to version bumps) using a GitHub App token (`MCTX_BOT_APP_ID` + `MCTX_BOT_PRIVATE_KEY` secrets).

### `dependabot-auto-merge.yml` — Dependabot Auto-Merge

Trigger: PR from `dependabot[bot]`. Auto-merges (squash) when: package ecosystem is `github_actions`, OR semver-patch updates, OR semver-minor direct:development updates.

---

All actions MUST be SHA-pinned (see GitHub Actions section above).
