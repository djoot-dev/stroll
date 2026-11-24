---
name: bump-version
description: >-
  Bump Stroll's semver version (patch, minor, major, or explicit version) across
  all app manifests, verify the build and test suite, and open a Pull Request
  against main. Use when the user asks to bump the version or prepare a release
  PR.
---

# Bumping Stroll's Version

Follow this workflow whenever bumping Stroll's version (`patch`, `minor`, `major`, or an explicit `X.Y.Z`).

## Steps

1. **Ensure a dedicated feature branch off `main`**
   - Never commit directly to `main` (per `AGENTS.md`).
   - Fetch `origin/main` and make sure you are on a clean feature branch branched from `origin/main` (e.g., `git checkout -b bump_version_vX_Y_Z origin/main`).

2. **Compute the new version**
   - Read the current `version` from `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` (all three should match).
   - Increment the requested component (`patch`, `minor`, or `major`), or use the explicit `X.Y.Z` version provided by the user.
   - Leave `site/package.json` untouched unless explicitly asked; it versions the marketing site independently.

3. **Update version files**
   - `package.json` — update `"version": "X.Y.Z"`.
   - `src-tauri/Cargo.toml` — update `[package]` `version = "X.Y.Z"`.
   - `src-tauri/tauri.conf.json` — update `"version": "X.Y.Z"` (`.github/workflows/release.yml` validates release tags `vX.Y.Z` against this value).
   - Run `cargo check --manifest-path src-tauri/Cargo.toml` so `src-tauri/Cargo.lock` updates the `stroll` package version automatically.
   - Inspect `git diff src-tauri/Cargo.lock` to verify only the `stroll` `[[package]]` entry changed (no unintended dependency bumps).

4. **Verify build and tests**
   - Install frontend dependencies if `node_modules` is absent: `bun install --frozen-lockfile`.
   - Run `bun run test` and `bun run build`.
   - Confirm `cargo check --manifest-path src-tauri/Cargo.toml` exited with code `0`.

5. **Commit, push, and create the Pull Request**
   - Stage only the version bump files:
     ```bash
     git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
     ```
   - Commit using the repository's convention:
     ```bash
     git commit -m "chore: bump <patch|minor|major> version to X.Y.Z"
     ```
   - Push the branch and open a PR targeting `main`:
     ```bash
     git push -u origin HEAD
     gh pr create --base main \
       --title "chore: bump <patch|minor|major> version to X.Y.Z" \
       --body "Bump version from \`<old>\` to \`X.Y.Z\` in \`package.json\`, \`src-tauri/Cargo.toml\`, \`src-tauri/Cargo.lock\`, and \`src-tauri/tauri.conf.json\`.

Verification:
- \`cargo check --manifest-path src-tauri/Cargo.toml\` passed
- \`bun run test\` passed
- \`bun run build\` passed"
     ```

6. **Release tags (only after PR merge and if requested)**
   - Per `AGENTS.md`, **never** create or push a `v*` tag until the version bump PR is merged into `main`.
   - Only if the user explicitly asks to merge/ship/release:
     1. Merge the PR (e.g., `gh pr merge <pr-number> --squash`). Note: in a git worktree where the branch is checked out, omit `--delete-branch` (or answer `N` to local branch deletion) so `gh` does not fail trying to delete the checked-out worktree branch.
     2. Fetch `origin/main` and verify the target commit on `main`.
     3. Tag and push from `main` to trigger `.github/workflows/release.yml`:
        ```bash
        git fetch origin main
        git tag vX.Y.Z origin/main
        git push origin vX.Y.Z
        ```
