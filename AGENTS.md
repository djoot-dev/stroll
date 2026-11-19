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
  - `src/services/readingOrder.ts`: Layer classifier (`config`, `types`, `core`, `ui`, `tests`), relative/`@/`/`python` import-graph topological sorter (`bottom-up` / `top-down`), test-to-implementation pairing, and `ReferencedContext` snippet extraction.
  - `src/services/diffParser.ts`: Converts unified patches + full base/head blobs into `DiffHunkBlock` and expandable `DiffGap` segments.
  - `src/services/http.ts` & `src/services/storage.ts`: Wrap `@tauri-apps/plugin-http` and `@tauri-apps/plugin-store` with automatic browser fallbacks (`fetch` / `localStorage`) when `__TAURI_INTERNALS__` is absent.
- **Keep `src-tauri/` minimal for Phase 1**:
  - Capabilities live in `src-tauri/capabilities/default.json` (`http:default` scoped to `https://api.github.com/**` and `https://github.com/**`).
  - Future Phase 2 `git` and `tree-sitter` Rust commands belong in `src-tauri/src/commands/` and are registered in `src-tauri/src/lib.rs`.
- **Offline Demo Mode**:
  - `src/data/mockPR.ts` provides a realistic 6-file PR loaded on startup so UI/UX changes can always be verified without a GitHub PAT.

## Git Workflow

- **Feature Branches Only:** Do all development on dedicated feature branches created from `main` (never commit directly to `main`).
- **Pull Requests:** All changes must be merged into `main` via a Pull Request.
