---
name: add-tauri-command
description: How to add a new Tauri v2 Rust command (e.g. git or tree-sitter AST parsing) and expose it safely to the Vue/TypeScript frontend.
---

# Adding a Tauri v2 Rust Command

Use this workflow when extending `src-tauri/` with native capabilities such as local `git` operations or `tree-sitter` AST parsing.

## Steps

1. **Create a focused Rust module** under `src-tauri/src/commands/`:
   - Add a new file (e.g. `src-tauri/src/commands/git.rs`) and export it from `src-tauri/src/commands/mod.rs`.
   - Annotate the command with `#[tauri::command]`, accept `serde::Deserialize` inputs, and return `Result<T, String>` where `T: serde::Serialize`.
2. **Register the command** in `src-tauri/src/lib.rs`:
   - Add it to `tauri::generate_handler![commands::get_runtime_info, commands::...]`.
3. **Update capabilities if needed**:
   - If the command or a new plugin requires permissions, update `src-tauri/capabilities/default.json`.
4. **Create a TypeScript wrapper** in `src/services/`:
   - Import `invoke` from `@tauri-apps/api/core`.
   - Check `'__TAURI_INTERNALS__' in window` and provide a graceful fallback or clear error when running in browser-only `bun run dev` mode.
5. **Verify**:
   - Run `cargo check --manifest-path src-tauri/Cargo.toml`
   - Run `bun run build` and `bun run test`
