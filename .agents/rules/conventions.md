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
5. **Verification**:
   - When modifying `src/services/readingOrder.ts` or `src/services/diffParser.ts`, update/add Vitest unit tests under `src/services/__tests__/` and run `bun run test` + `bun run build`.
