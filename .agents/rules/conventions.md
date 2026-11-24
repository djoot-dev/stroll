---
description: Core coding conventions and architectural guardrails for Stroll
---

# Stroll Workspace Rules

1. **Use Bun exclusively**: Always run `bun install`, `bun run ...`, and `bunx ...`. Never introduce `package-lock.json`, `npm`, or `node` commands in scripts or docs.
2. **Vue 3 & Pinia conventions**:
   - Use `<script setup lang="ts">` for all `.vue` components.
   - Use Composition API `defineStore('name', () => { ... })` for Pinia stores in `src/stores/`.
   - Use `@lucide/vue` for icons (never `lucide-vue-next`).
3. **Tailwind CSS v4**:
   - Define theme tokens in `src/style.css` under `@theme`. Do not recreate `tailwind.config.js` or `postcss.config.js`.
4. **Tauri v2 Runtime Safety**:
   - Any code calling `@tauri-apps/api`, `@tauri-apps/plugin-http`, or `@tauri-apps/plugin-store` must guard on `'__TAURI_INTERNALS__' in window` (or go through `src/services/http.ts` / `src/services/storage.ts`) so `bun run dev` in a browser never crashes.
   - Keep `src-tauri/capabilities/default.json` least-privilege; only allow explicitly required domains and plugin permissions.
5. **Keyboard Shortcuts**:
   - Never hardcode `⌘`, `Ctrl`, `⌥`, or `navigator.platform` checks in components. Use `src/services/shortcuts.ts` (`formatShortcut`, `altKeyLabel`, `altKeyName`, `isModKey`, `getShortcutGroups`) so shortcuts adapt to the host OS (`⌘`/`⌥` on macOS, `Ctrl`/`Alt` on Windows/Linux), join keys consistently with `+`, and use `⇧` for Shift on all platforms.
6. **Verification**:
   - Run `bun run test` and `bun run build` after changes; when modifying `src/services/readingOrder.ts`, `src/services/diffParser.ts`, or other core services, update or add Vitest unit tests under `src/services/__tests__/`.
   - **Always run visual verification for UI/UX changes**: Whenever you modify components, styles, layout, or user-facing behavior (`src/components/`, `src/App.vue`, `src/style.css`, `index.html`, or UI state), start `bun run dev` (serves at `http://localhost:1420`) and inspect the live app in a browser (using the browser subagent).
   - Verify the affected views and interactive states (including offline demo mode via `src/data/mockPR.ts`, which loads without a GitHub PAT), check for layout/styling regressions and console errors, and confirm the fix visually before finishing.
