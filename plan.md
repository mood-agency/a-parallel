# Plan: Cross-Platform Native Git Publishing

## Context
- `packages/native-git/` has a Rust/NAPI-RS module (gitoxide) that currently only has a Windows x64 `.node` binary committed to git
- The auto-generated `index.js` already supports loading platform-specific npm packages (`@funny/native-git-{platform}`)
- `@funny/core` has `@funny/native-git` as an `optionalDependency`
- Target: **3 essential platforms** — Windows x64, macOS ARM64, Linux x64 GNU
- Registry: **public npm**

## Important: npm scope
The root package publishes as `@ironmussa/funny`. The native-git uses `@funny` scope internally. For publishing platform packages to npm, we need to use a scope you own. The plan uses `@funny` scope — if that's not available on npm, we'll need to switch to `@ironmussa` scope and update accordingly.

---

## Step 1 — Limit triples in `package.json` to essential 3

Update `packages/native-git/package.json`:
- Remove `"private": true`
- Change `triples` from `{ "defaults": true }` to explicit list of 3 targets
- Add `optionalDependencies` for the 3 platform packages
- Add `prepublishOnly` and `artifacts` scripts
- Add `"os"` and `"cpu"` fields for npm filtering

## Step 2 — Regenerate `index.js` with limited targets

Run `napi create-npm-dirs` to:
- Generate `npm/` directory with platform-specific `package.json` files:
  - `npm/win32-x64-msvc/package.json`
  - `npm/darwin-arm64/package.json`
  - `npm/linux-x64-gnu/package.json`
- Regenerate `index.js` to only handle the 3 targets (instead of the current 700+ line file for all platforms)

## Step 3 — Remove committed `.node` binary from git

- Add `*.node` to `packages/native-git/.gitignore`
- Remove `native-git.win32-x64-msvc.node` from git tracking (file stays locally for dev)

## Step 4 — Create GitHub Actions workflow

New file `.github/workflows/native-git.yml` with:
- **Trigger**: on push tags `native-git-v*` or workflow_dispatch
- **Build job**: matrix strategy for 3 platforms
  - `windows-latest` → `win32-x64-msvc`
  - `macos-latest` → `darwin-arm64` (Apple Silicon runners)
  - `ubuntu-22.04` → `linux-x64-gnu`
- Each job: install Rust stable, run `napi build --platform --release`, upload `.node` artifact
- **Publish job** (depends on build):
  - Download all artifacts
  - Run `napi artifacts` to organize binaries into `npm/` dirs
  - Run `napi prepublish -t npm` to prepare platform packages
  - Publish each platform package + main package to npm with `NPM_TOKEN` secret

## Step 5 — Add `npm/` directory structure to git

Commit the `npm/` directory with `package.json` files (not binaries). These define the platform-specific packages that users' package managers resolve. The `.node` files get placed here only during CI.

## Step 6 — Local dev workflow

After this change:
- Local dev: run `bun run build:native` as before — binary goes to `packages/native-git/` and loads via the local file path in `index.js`
- CI publish: builds on 3 platforms → publishes platform packages to npm
- End user: `bun install` resolves the correct platform package automatically via `optionalDependencies`

---

## Files changed
| File | Action |
|------|--------|
| `packages/native-git/package.json` | Edit (triples, optionalDeps, scripts, remove private) |
| `packages/native-git/index.js` | Regenerate via NAPI CLI (smaller, 3 targets only) |
| `packages/native-git/.gitignore` | Add `*.node` |
| `packages/native-git/npm/win32-x64-msvc/package.json` | Create |
| `packages/native-git/npm/darwin-arm64/package.json` | Create |
| `packages/native-git/npm/linux-x64-gnu/package.json` | Create |
| `.github/workflows/native-git.yml` | Create |
| git tracking | Remove `native-git.win32-x64-msvc.node` from index |
