# AGENTS.md — Stroll

Guidance for AI coding agents working in this repository.

## Project Overview

**Stroll** is a cross-platform desktop application for reviewing GitHub Pull Requests in a guided, step-by-step tour instead of a flat alphabetical file list.

- **Runtime & Package Manager:** Bun (`bun`, `bunx`) — **do not use `npm`, `yarn`, or `node`**
- **Desktop Shell:** Tauri v2 (`src-tauri/`) with `@tauri-apps/plugin-http` and `@tauri-apps/plugin-store`
- **Frontend:** Vue 3 (`<script setup lang="ts">`), TypeScript (strict), Pinia (Composition API stores)
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite` and `@theme` tokens in `src/style.css` (no `tailwind.config.js`)
- **Code & Diff Rendering:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/theme-one-dark`, `@lezer/highlight`)
- **Icons:** `@lucide/vue` (not the deprecated `lucide-vue-next`)
- **Testing:** Vitest (`bun run test`)

## Essential Commands

```bash
bun install                                        # Install JS/TS dependencies
bun run dev                                        # Start Vite dev server (port 1420)
bun run test                                       # Run Vitest unit tests
bun run build                                      # Type-check (vue-tsc) + Vite production build
bun run tauri dev                                  # Launch Tauri v2 desktop app
cargo check --manifest-path src-tauri/Cargo.toml   # Verify Rust backend compiles
```

## Architecture & Boundaries

- **Keep business logic in TypeScript** (`src/services/`, `src/stores/`):
  - `src/services/github.ts`: GitHub GraphQL API v4 client + REST `/pulls/{n}/files` patch loader.
  - `src/services/readingOrder.ts`: Layer classifier (`config`, `types`, `core`, `ui`, `tests`), relative/`@/`/`python`/C# (`using` & namespace) import-graph topological sorter (`bottom-up` / `top-down`), test-to-implementation pairing, and `ReferencedContext` snippet extraction.
  - `src/services/diffParser.ts`: Converts unified patches + full base/head blobs into `DiffHunkBlock` and expandable `DiffGap` segments.
  - `src/services/http.ts` & `src/services/storage.ts`: Wrap `@tauri-apps/plugin-http` and `@tauri-apps/plugin-store` with automatic browser fallbacks (`fetch` / `localStorage`) when `__TAURI_INTERNALS__` is absent.
- **Keep `src-tauri/` minimal for Phase 1**:
  - Capabilities live in `src-tauri/capabilities/default.json` (`http:default` scoped to `https://api.github.com/**` and `https://github.com/**`).
  - Future Phase 2 `git` and `tree-sitter` Rust commands belong in `src-tauri/src/commands/` and are registered in `src-tauri/src/lib.rs`.
- **Offline Demo Mode**:
  - `src/data/mockPR.ts` provides a realistic 6-file PR loaded on startup so UI/UX changes can always be verified without a GitHub PAT.

## Verification & Visual Checks

- **Unit Tests & Build:** Run `bun run test` and `bun run build` after code changes (and `cargo check --manifest-path src-tauri/Cargo.toml` when touching `src-tauri/`).
- **Mandatory Visual Verification for UI/UX Changes:** Any change affecting UI, styling, layout, components, or user-facing behavior (`src/components/`, `src/App.vue`, `src/style.css`, `index.html`, or UI state) **must** be visually verified in a live browser before finishing:
  1. Start the Vite dev server (`bun run dev`, which serves `http://localhost:1420` with `strictPort: true`).
  2. Open `http://localhost:1420` in the browser (via the browser subagent) — offline demo mode (`src/data/mockPR.ts`) loads automatically without a GitHub PAT, and browser fallbacks handle Tauri APIs.
  3. Inspect the rendered UI, exercise the modified flows/states (modals, popovers, themes, responsive layout), and verify there are no visual regressions or console/runtime errors.

## Git Workflow

- **Feature Branches Only:** Do all development on dedicated feature branches created from `main` (never commit directly to `main`).
- **Pull Requests:** All changes must be merged into `main` via a Pull Request. Before creating a PR (or pushing updates to an open PR when the base branch has moved), fetch `origin`, rebase the branch onto the target base branch (e.g., `git fetch origin && git rebase origin/main`), and re-run `bun run test` and `bun run build`.
- **Release Tags:** Only create and push release tags (`v*`) from `main` after the version bump PR has been merged.
