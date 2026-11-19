# Stroll — Guided Code Review

A cross-platform desktop application built with **Tauri v2**, **Vue 3**, **TypeScript**, **Pinia**, **Tailwind CSS v4**, and **CodeMirror 6** for reviewing GitHub Pull Requests as a guided, dependency-aware tour.

## Features

- **Guided Reading Order Engine**: Classifies changed files into architectural layers (`config`, `types`, `core`, `ui`, `tests`), parses relative imports to sort dependencies before consumers (`Bottom-Up` or `Top-Down`), and pairs test files immediately after their implementation.
- **Isolated Single-File Diff Viewer**: Syntax-highlighted diffs via CodeMirror 6 with collapsible unchanged sections (`Expand N unchanged lines`) and **Referenced PR Context** cards for modified types/functions imported from other files in the same PR.
- **End-to-End GitHub Review Flow**: Load any PR by URL or from PRs awaiting your review, add inline draft comments persisted locally via `@tauri-apps/plugin-store`, and submit `APPROVE`, `REQUEST_CHANGES`, or `COMMENT` reviews via GitHub GraphQL.
- **Keyboard-First Navigation**: `J` / `→` Next step, `K` / `←` Previous step, `M` Mark reviewed, `[` Toggle sidebar, `R` Finish review.

## Prerequisites

- [Bun](https://bun.sh/) (latest)
- [Rust & Cargo](https://rustup.rs/) (for Tauri v2 desktop builds)

## Getting Started

```bash
bun install
bun run test       # Run Vitest unit tests
bun run tauri dev  # Launch the Tauri v2 desktop app
```
