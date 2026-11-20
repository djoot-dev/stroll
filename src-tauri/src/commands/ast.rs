use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tree_sitter::{Language, Node, Parser};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRepoSymbolRequest {
    pub repo_path: String,
    pub importer_path: String,
    pub symbol_name: String,
    pub import_specifier: Option<String>,
    /// Repo-relative file known to declare the symbol (e.g. from the C# type index).
    /// When set, path resolution from `import_specifier` is skipped.
    #[serde(default)]
    pub target_path: Option<String>,
    /// When set, `symbol_name` is a member (enum member, constant, ...) looked up inside the
    /// type/enum/impl named `container` (e.g. `Status.Active`, `Limits::MAX`).
    #[serde(default)]
    pub container: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRepoSymbol {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: usize,
    pub language: String,
    pub doc_comment: Option<String>,
    /// Declaration text, capped at `MAX_SNIPPET_LINES`; the UI shows a prefix and expands on demand.
    pub snippet: String,
    /// Line count of the whole declaration (may exceed what `snippet` holds).
    pub total_lines: usize,
}

const SCRIPT_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "rs", "py", "vue", "cs",
];

fn normalize_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn try_resolve_candidate(repo_root: &Path, base: &Path) -> Option<PathBuf> {
    if base.is_file() {
        return base.canonicalize().ok().filter(|p| p.starts_with(repo_root));
    }

    for ext in SCRIPT_EXTENSIONS {
        let with_ext = base.with_extension(ext);
        if with_ext.is_file() {
            return with_ext
                .canonicalize()
                .ok()
                .filter(|p| p.starts_with(repo_root));
        }
    }

    if base.is_dir() {
        for index_name in &[
            "index.ts",
            "index.tsx",
            "index.mts",
            "index.js",
            "index.jsx",
            "index.mjs",
            "index.vue",
            "mod.rs",
            "__init__.py",
        ] {
            let idx = base.join(index_name);
            if idx.is_file() {
                return idx.canonicalize().ok().filter(|p| p.starts_with(repo_root));
            }
        }
    }

    None
}

/// Strips `//` line comments, `/* ... */` block comments, and trailing commas from JSONC.
fn strip_jsonc(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    let mut in_string = false;
    let mut escaped = false;

    while i < len {
        let ch = chars[i];
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        if ch == '"' {
            in_string = true;
            out.push(ch);
            i += 1;
            continue;
        }

        if ch == '/' && i + 1 < len && chars[i + 1] == '/' {
            i += 2;
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        if ch == '/' && i + 1 < len && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < len && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(len);
            continue;
        }

        out.push(ch);
        i += 1;
    }

    // Remove trailing commas before `}` or `]` outside strings.
    let out_chars: Vec<char> = out.chars().collect();
    let mut cleaned = String::with_capacity(out.len());
    let mut j = 0;
    in_string = false;
    escaped = false;
    while j < out_chars.len() {
        let ch = out_chars[j];
        if in_string {
            cleaned.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            j += 1;
            continue;
        }

        if ch == '"' {
            in_string = true;
            cleaned.push(ch);
            j += 1;
            continue;
        }

        if ch == ',' {
            let mut k = j + 1;
            while k < out_chars.len() && out_chars[k].is_whitespace() {
                k += 1;
            }
            if k < out_chars.len() && (out_chars[k] == '}' || out_chars[k] == ']') {
                j += 1;
                continue;
            }
        }

        cleaned.push(ch);
        j += 1;
    }

    cleaned
}

fn match_alias_pattern(pattern: &str, target: &str, spec: &str) -> Option<String> {
    if let Some((prefix, suffix)) = pattern.split_once('*') {
        if spec.len() >= prefix.len() + suffix.len()
            && spec.starts_with(prefix)
            && spec.ends_with(suffix)
        {
            let captured = &spec[prefix.len()..spec.len() - suffix.len()];
            return Some(target.replace('*', captured));
        }
        None
    } else if pattern == spec {
        Some(target.to_string())
    } else {
        None
    }
}

fn resolve_tsconfig_aliases(
    config_path: &Path,
    canonical_root: &Path,
    spec: &str,
    visited: &mut HashSet<PathBuf>,
    depth: usize,
) -> Option<PathBuf> {
    if depth > 4 || !config_path.is_file() {
        return None;
    }
    let canonical_cfg = config_path.canonicalize().ok()?;
    if !canonical_cfg.starts_with(canonical_root) || !visited.insert(canonical_cfg.clone()) {
        return None;
    }

    let raw = fs::read_to_string(&canonical_cfg).ok()?;
    let cleaned = strip_jsonc(&raw);
    let val: serde_json::Value = serde_json::from_str(&cleaned).ok()?;
    let cfg_dir = canonical_cfg.parent()?;

    if let Some(compiler_opts) = val.get("compilerOptions").and_then(|v| v.as_object()) {
        let base_dir = compiler_opts
            .get("baseUrl")
            .and_then(|v| v.as_str())
            .map(|b| cfg_dir.join(b))
            .unwrap_or_else(|| cfg_dir.to_path_buf());

        if let Some(paths_obj) = compiler_opts.get("paths").and_then(|v| v.as_object()) {
            // Prefer more specific patterns first (longer prefix before `*`).
            let mut entries: Vec<(&str, &Vec<serde_json::Value>)> = paths_obj
                .iter()
                .filter_map(|(k, v)| v.as_array().map(|arr| (k.as_str(), arr)))
                .collect();
            entries.sort_by(|(a, _), (b, _)| b.len().cmp(&a.len()));

            for (pattern, targets) in entries {
                for target_val in targets {
                    let Some(target_str) = target_val.as_str() else {
                        continue;
                    };
                    if let Some(mapped) = match_alias_pattern(pattern, target_str, spec) {
                        let candidate = base_dir.join(mapped);
                        if let Some(found) = try_resolve_candidate(canonical_root, &candidate) {
                            return Some(found);
                        }
                    }
                }
            }
        }
    }

    if let Some(extends) = val.get("extends").and_then(|v| v.as_str()) {
        if extends.starts_with('.') {
            let mut ext_path = cfg_dir.join(extends);
            if ext_path.extension().is_none() && !ext_path.is_file() {
                ext_path = ext_path.with_extension("json");
            }
            if let Some(found) =
                resolve_tsconfig_aliases(&ext_path, canonical_root, spec, visited, depth + 1)
            {
                return Some(found);
            }
        }
    }

    if let Some(refs) = val.get("references").and_then(|v| v.as_array()) {
        for r in refs {
            if let Some(ref_path_str) = r.get("path").and_then(|v| v.as_str()) {
                let ref_path = cfg_dir.join(ref_path_str);
                let ref_cfg = if ref_path.is_dir() {
                    ref_path.join("tsconfig.json")
                } else {
                    ref_path
                };
                if let Some(found) =
                    resolve_tsconfig_aliases(&ref_cfg, canonical_root, spec, visited, depth + 1)
                {
                    return Some(found);
                }
            }
        }
    }

    None
}

fn extract_quoted_literal(s: &str) -> Option<&str> {
    for quote in ['\'', '"'] {
        if let Some(start) = s.find(quote) {
            let rest = &s[start + 1..];
            if let Some(end) = rest.find(quote) {
                return Some(&rest[..end]);
            }
        }
    }
    None
}

fn extract_vite_replacement_path(expr: &str) -> Option<String> {
    if let Some(idx) = expr.find("new URL(") {
        if let Some(lit) = extract_quoted_literal(&expr[idx + 8..]) {
            return Some(lit.to_string());
        }
    }
    if let Some(idx) = expr.find("path.resolve(") {
        let after = &expr[idx + 13..];
        let mut parts: Vec<&str> = Vec::new();
        let mut rest = after;
        while let Some(lit) = extract_quoted_literal(rest) {
            parts.push(lit);
            let pos = rest.find(lit).unwrap_or(0) + lit.len() + 1;
            if pos >= rest.len() {
                break;
            }
            rest = &rest[pos..];
        }
        if !parts.is_empty() {
            return Some(parts.join("/"));
        }
    }
    extract_quoted_literal(expr).map(|s| s.to_string())
}

fn resolve_vite_aliases(dir: &Path, canonical_root: &Path, spec: &str) -> Option<PathBuf> {
    for cfg_name in [
        "vite.config.ts",
        "vite.config.mts",
        "vite.config.js",
        "vite.config.mjs",
    ] {
        let cfg_path = dir.join(cfg_name);
        if !cfg_path.is_file() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&cfg_path) else {
            continue;
        };

        let mut aliases: Vec<(String, String)> = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            // Object style: `'@': fileURLToPath(new URL('./src', import.meta.url))` or `'@components': './src/components'`
            if let Some(colon) = trimmed.find(':') {
                let left = trimmed[..colon].trim();
                let right = trimmed[colon + 1..].trim();
                if let Some(key) = extract_quoted_literal(left) {
                    if key.starts_with('@') || key.starts_with('~') {
                        if let Some(rep) = extract_vite_replacement_path(right) {
                            aliases.push((key.to_string(), rep));
                        }
                    }
                }
            }
            // Array style on single line: `{ find: '@', replacement: ... }`
            if let (Some(find_idx), Some(rep_idx)) = (trimmed.find("find:"), trimmed.find("replacement:")) {
                if let (Some(key), Some(rep)) = (
                    extract_quoted_literal(&trimmed[find_idx + 5..]),
                    extract_vite_replacement_path(&trimmed[rep_idx + 12..]),
                ) {
                    aliases.push((key.to_string(), rep));
                }
            }
        }

        // Prefer longest alias prefix first
        aliases.sort_by(|(a, _), (b, _)| b.len().cmp(&a.len()));
        for (alias_key, rep) in aliases {
            let key_no_slash = alias_key.trim_end_matches('/');
            if spec == key_no_slash || spec.starts_with(&format!("{key_no_slash}/")) {
                let rest = spec
                    .strip_prefix(key_no_slash)
                    .unwrap_or("")
                    .trim_start_matches('/');
                let rep_clean = rep.trim_start_matches('/');
                let base = if rest.is_empty() {
                    dir.join(rep_clean)
                } else {
                    dir.join(rep_clean).join(rest)
                };
                if let Some(found) = try_resolve_candidate(canonical_root, &base) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn ancestor_project_dirs(canonical_root: &Path, importer_path: &str) -> Vec<PathBuf> {
    let importer_abs = canonical_root.join(importer_path);
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut cur = importer_abs.parent();
    while let Some(d) = cur {
        if d.starts_with(canonical_root) {
            dirs.push(d.to_path_buf());
        }
        if d == canonical_root {
            break;
        }
        cur = d.parent();
    }
    if dirs.is_empty() || dirs.last().map(|d| d != canonical_root).unwrap_or(true) {
        dirs.push(canonical_root.to_path_buf());
    }
    dirs
}

/// Resolves an import specifier (relative, `@/` / `~/` / `tsconfig.json` / `vite.config.*` alias, or module path) to a file inside `repo_root`.
pub fn resolve_target_file(
    repo_root: &Path,
    importer_path: &str,
    import_specifier: Option<&str>,
) -> Option<PathBuf> {
    let canonical_root = repo_root.canonicalize().ok()?;

    let spec = match import_specifier {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => {
            let same_file = canonical_root.join(importer_path);
            return try_resolve_candidate(&canonical_root, &same_file);
        }
    };

    // 1. Relative path: ./foo or ../bar
    if spec.starts_with("./") || spec.starts_with("../") {
        let importer_abs = canonical_root.join(importer_path);
        let importer_dir = importer_abs.parent().unwrap_or(&canonical_root);
        let candidate = importer_dir.join(spec);
        if let Some(found) = try_resolve_candidate(&canonical_root, &candidate) {
            return Some(found);
        }
    }

    let ancestors = ancestor_project_dirs(&canonical_root, importer_path);

    // 2. tsconfig.json / tsconfig.app.json / jsconfig.json `paths` & `baseUrl`
    let mut visited_configs = HashSet::new();
    for dir in &ancestors {
        for cfg_name in ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"] {
            let cfg_path = dir.join(cfg_name);
            if let Some(found) = resolve_tsconfig_aliases(
                &cfg_path,
                &canonical_root,
                spec,
                &mut visited_configs,
                0,
            ) {
                return Some(found);
            }
        }
    }

    // 3. vite.config.{ts,mts,js,mjs} `resolve.alias`
    for dir in &ancestors {
        if let Some(found) = resolve_vite_aliases(dir, &canonical_root, spec) {
            return Some(found);
        }
    }

    // 4. Conventional `@/` and `~/` aliases (try nearest project root's `src/...` first, then root)
    if let Some(rest) = spec.strip_prefix("@/").or_else(|| spec.strip_prefix("~/")) {
        for dir in &ancestors {
            let is_project_root = *dir == canonical_root
                || dir.join("package.json").is_file()
                || dir.join("tsconfig.json").is_file()
                || dir.join("jsconfig.json").is_file()
                || dir.join("src").is_dir();
            if !is_project_root {
                continue;
            }
            for base in [dir.join("src").join(rest), dir.join(rest)] {
                if let Some(found) = try_resolve_candidate(&canonical_root, &base) {
                    return Some(found);
                }
            }
        }
    }

    // 5. Nuxt `~~/` and `@@/` root aliases
    if let Some(rest) = spec.strip_prefix("~~/").or_else(|| spec.strip_prefix("@@/")) {
        for dir in &ancestors {
            if *dir == canonical_root || dir.join("package.json").is_file() {
                let base = dir.join(rest);
                if let Some(found) = try_resolve_candidate(&canonical_root, &base) {
                    return Some(found);
                }
            }
        }
    }

    // 3. Rust `crate::...` or module path
    if spec.contains("::") {
        let cleaned = spec
            .strip_prefix("crate::")
            .or_else(|| spec.strip_prefix("self::"))
            .or_else(|| spec.strip_prefix("super::"))
            .unwrap_or(spec)
            .replace("::", "/");
        for base in [
            canonical_root.join("src").join(&cleaned),
            canonical_root.join("src-tauri/src").join(&cleaned),
            canonical_root.join(&cleaned),
        ] {
            if let Some(found) = try_resolve_candidate(&canonical_root, &base) {
                return Some(found);
            }
        }
    }

    // 4. Python dotted module path or bare repo-relative path
    let normalized = if !spec.contains('/') && spec.contains('.') {
        spec.replace('.', "/")
    } else {
        spec.to_string()
    };
    for base in [
        canonical_root.join(&normalized),
        canonical_root.join("src").join(&normalized),
    ] {
        if let Some(found) = try_resolve_candidate(&canonical_root, &base) {
            return Some(found);
        }
    }

    None
}

fn resolve_csharp_symbol_file(
    canonical_root: &Path,
    importer_path: &str,
    import_specifier: Option<&str>,
    symbol_name: &str,
) -> Option<PathBuf> {
    if !importer_path.to_ascii_lowercase().ends_with(".cs") {
        return None;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(spec) = import_specifier.map(str::trim).filter(|s| !s.is_empty()) {
        let ns_path = spec.replace('.', "/");
        candidates.push(canonical_root.join(&ns_path).join(format!("{symbol_name}.cs")));
        candidates.push(canonical_root.join("src").join(&ns_path).join(format!("{symbol_name}.cs")));

        // Strip leading root project segment (e.g. `MyApp.Services` -> `Services/OrderService.cs`)
        if let Some((_, tail)) = ns_path.split_once('/') {
            candidates.push(canonical_root.join(tail).join(format!("{symbol_name}.cs")));
            candidates.push(canonical_root.join("src").join(tail).join(format!("{symbol_name}.cs")));
        }
    }

    // Same directory as importer
    if let Some(parent) = canonical_root.join(importer_path).parent() {
        candidates.push(parent.join(format!("{symbol_name}.cs")));
    }

    for cand in candidates {
        if let Some(found) = try_resolve_candidate(canonical_root, &cand) {
            return Some(found);
        }
    }

    None
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LangKind {
    TypeScript,
    Tsx,
    JavaScript,
    Rust,
    Python,
    CSharp,
}

fn detect_language(path: &Path) -> Option<(LangKind, Language, &'static str)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "ts" | "mts" | "cts" => Some((
            LangKind::TypeScript,
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            "typescript",
        )),
        "tsx" => Some((
            LangKind::Tsx,
            tree_sitter_typescript::LANGUAGE_TSX.into(),
            "tsx",
        )),
        "js" | "jsx" | "mjs" | "cjs" => Some((
            LangKind::JavaScript,
            tree_sitter_javascript::LANGUAGE.into(),
            "javascript",
        )),
        "rs" => Some((
            LangKind::Rust,
            tree_sitter_rust::LANGUAGE.into(),
            "rust",
        )),
        "py" => Some((
            LangKind::Python,
            tree_sitter_python::LANGUAGE.into(),
            "python",
        )),
        "cs" => Some((
            LangKind::CSharp,
            tree_sitter_c_sharp::LANGUAGE.into(),
            "csharp",
        )),
        _ => None,
    }
}

fn extract_leading_doc_comment(lines: &[&str], decl_row: usize) -> Option<String> {
    if decl_row == 0 {
        return None;
    }

    let mut i = decl_row - 1;
    // Skip C# / Rust attributes (e.g. `[ApiController]`, `#[derive(...)]`) directly above the declaration
    loop {
        let trimmed = lines.get(i).map(|l| l.trim()).unwrap_or("");
        if (trimmed.starts_with('[') || trimmed.starts_with("#[")) && trimmed.ends_with(']') {
            if i == 0 {
                return None;
            }
            i -= 1;
        } else {
            break;
        }
    }

    if lines.get(i).map(|l| l.trim().is_empty()).unwrap_or(true) {
        return None;
    }

    let mut collected: Vec<&str> = Vec::new();

    if lines[i].trim().ends_with("*/") {
        loop {
            collected.push(lines[i]);
            if lines[i].trim().starts_with("/*") || i == 0 {
                break;
            }
            i -= 1;
        }
        collected.reverse();
        return Some(collected.join("\n").trim().to_string());
    }

    loop {
        let trimmed = lines[i].trim();
        if trimmed.starts_with("//") || trimmed.starts_with('#') {
            collected.push(lines[i]);
            if i == 0 {
                break;
            }
            i -= 1;
        } else {
            break;
        }
    }

    if collected.is_empty() {
        None
    } else {
        collected.reverse();
        Some(collected.join("\n").trim().to_string())
    }
}

/// Upper bound on how much of a declaration is sent to the UI.
const MAX_SNIPPET_LINES: usize = 400;

fn declaration_end(lines: &[&str], start_row: usize, end_row: usize) -> usize {
    let mut end = end_row.min(lines.len().saturating_sub(1));
    while end > start_row && lines[end].trim().is_empty() {
        end -= 1;
    }
    end
}

fn extract_snippet(lines: &[&str], start_row: usize, end_row: usize) -> String {
    let end = declaration_end(lines, start_row, end_row);
    let max_end = (start_row + MAX_SNIPPET_LINES - 1).min(end);
    lines[start_row..=max_end].join("\n").trim_end().to_string()
}

fn snippet_total_lines(lines: &[&str], start_row: usize, end_row: usize) -> usize {
    declaration_end(lines, start_row, end_row) - start_row + 1
}

fn node_text<'a>(node: Node, source: &'a [u8]) -> Option<&'a str> {
    node.utf8_text(source).ok()
}

struct FoundDecl {
    kind: &'static str,
    start_row: usize,
    end_row: usize,
}

fn find_ts_js_decl(node: Node, source: &[u8], target: &str, outer_node: Option<Node>) -> Option<FoundDecl> {
    let kind = node.kind();
    let effective_outer = outer_node.unwrap_or(node);

    let matched_kind: Option<&'static str> = match kind {
        "interface_declaration" => Some("interface"),
        "type_alias_declaration" => Some("type"),
        "class_declaration" => Some("class"),
        "enum_declaration" => Some("enum"),
        "function_declaration" => Some("function"),
        _ => None,
    };

    if let Some(decl_kind) = matched_kind {
        if let Some(name_node) = node.child_by_field_name("name") {
            if node_text(name_node, source) == Some(target) {
                return Some(FoundDecl {
                    kind: decl_kind,
                    start_row: effective_outer.start_position().row,
                    end_row: effective_outer.end_position().row,
                });
            }
        }
    }

    if kind == "enum_body" {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            let name_node = match child.kind() {
                "property_identifier" => Some(child),
                "enum_assignment" => child.child_by_field_name("name"),
                _ => None,
            };
            if let Some(name_node) = name_node {
                if node_text(name_node, source) == Some(target) {
                    return Some(FoundDecl {
                        kind: "enumMember",
                        start_row: child.start_position().row,
                        end_row: child.end_position().row,
                    });
                }
            }
        }
        return None;
    }

    if kind == "lexical_declaration" || kind == "variable_declaration" {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "variable_declarator" {
                if let Some(name_node) = child.child_by_field_name("name") {
                    if node_text(name_node, source) == Some(target) {
                        return Some(FoundDecl {
                            kind: "const",
                            start_row: effective_outer.start_position().row,
                            end_row: effective_outer.end_position().row,
                        });
                    }
                }
            }
        }
    }

    if kind == "export_statement" {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if let Some(found) = find_ts_js_decl(child, source, target, Some(node)) {
                return Some(found);
            }
        }
        return None;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = find_ts_js_decl(child, source, target, None) {
            return Some(found);
        }
    }

    None
}

fn find_rust_decl(node: Node, source: &[u8], target: &str) -> Option<FoundDecl> {
    let decl_kind: Option<&'static str> = match node.kind() {
        "struct_item" => Some("struct"),
        "enum_item" => Some("enum"),
        "trait_item" => Some("interface"),
        "type_item" => Some("type"),
        "function_item" => Some("fn"),
        "const_item" | "static_item" => Some("const"),
        "enum_variant" => Some("enumMember"),
        _ => None,
    };

    if let Some(kind) = decl_kind {
        if let Some(name_node) = node.child_by_field_name("name") {
            if node_text(name_node, source) == Some(target) {
                return Some(FoundDecl {
                    kind,
                    start_row: node.start_position().row,
                    end_row: node.end_position().row,
                });
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = find_rust_decl(child, source, target) {
            return Some(found);
        }
    }

    None
}

fn find_python_decl(node: Node, source: &[u8], target: &str, outer_node: Option<Node>) -> Option<FoundDecl> {
    let effective_outer = outer_node.unwrap_or(node);

    let decl_kind: Option<&'static str> = match node.kind() {
        "class_definition" => Some("class"),
        "function_definition" => Some("def"),
        _ => None,
    };

    if let Some(kind) = decl_kind {
        if let Some(name_node) = node.child_by_field_name("name") {
            if node_text(name_node, source) == Some(target) {
                return Some(FoundDecl {
                    kind,
                    start_row: effective_outer.start_position().row,
                    end_row: effective_outer.end_position().row,
                });
            }
        }
    }

    if node.kind() == "assignment" {
        if let Some(left) = node.child_by_field_name("left") {
            if left.kind() == "identifier" && node_text(left, source) == Some(target) {
                return Some(FoundDecl {
                    kind: "const",
                    start_row: effective_outer.start_position().row,
                    end_row: effective_outer.end_position().row,
                });
            }
        }
    }

    if node.kind() == "decorated_definition" {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if let Some(found) = find_python_decl(child, source, target, Some(node)) {
                return Some(found);
            }
        }
        return None;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = find_python_decl(child, source, target, None) {
            return Some(found);
        }
    }

    None
}

fn find_csharp_decl(node: Node, source: &[u8], target: &str) -> Option<FoundDecl> {
    let decl_kind: Option<&'static str> = match node.kind() {
        "class_declaration" => Some("class"),
        "struct_declaration" => Some("struct"),
        "record_declaration" => Some("record"),
        "interface_declaration" => Some("interface"),
        "enum_declaration" => Some("enum"),
        "method_declaration" => Some("method"),
        "enum_member_declaration" => Some("enumMember"),
        _ => None,
    };

    if node.kind() == "field_declaration" {
        if let Some(found) = find_csharp_constant_field(node, source, target) {
            return Some(found);
        }
    }

    if let Some(kind) = decl_kind {
        if let Some(name_node) = node.child_by_field_name("name") {
            if node_text(name_node, source) == Some(target) {
                return Some(FoundDecl {
                    kind,
                    start_row: node.start_position().row,
                    end_row: node.end_position().row,
                });
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = find_csharp_decl(child, source, target) {
            return Some(found);
        }
    }

    None
}

/// Matches `const` and `static readonly` C# fields named `target`.
fn find_csharp_constant_field(node: Node, source: &[u8], target: &str) -> Option<FoundDecl> {
    let mut is_const = false;
    let mut is_static = false;
    let mut is_readonly = false;
    let mut declaration = None;
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "modifier" => match node_text(child, source).map(str::trim) {
                Some("const") => is_const = true,
                Some("static") => is_static = true,
                Some("readonly") => is_readonly = true,
                _ => {}
            },
            "variable_declaration" => declaration = Some(child),
            _ => {}
        }
    }
    if !(is_const || (is_static && is_readonly)) {
        return None;
    }
    let declaration = declaration?;
    let mut cursor = declaration.walk();
    for declarator in declaration.children(&mut cursor) {
        if declarator.kind() != "variable_declarator" {
            continue;
        }
        if let Some(name_node) = declarator.child_by_field_name("name") {
            if node_text(name_node, source) == Some(target) {
                return Some(FoundDecl {
                    kind: "const",
                    start_row: node.start_position().row,
                    end_row: node.end_position().row,
                });
            }
        }
    }
    None
}

/// Collects nodes declaring a type-like container named `name` (class, struct, enum, record,
/// interface, Rust `impl Name`, ...) in document order.
fn collect_container_nodes<'a>(node: Node<'a>, source: &[u8], name: &str, out: &mut Vec<Node<'a>>) {
    let kind = node.kind();
    let is_container_kind = matches!(
        kind,
        "class_declaration"
            | "abstract_class_declaration"
            | "struct_declaration"
            | "record_declaration"
            | "interface_declaration"
            | "enum_declaration"
            | "class_definition"
            | "struct_item"
            | "enum_item"
            | "trait_item"
            | "impl_item"
    );
    if is_container_kind {
        let name_node = if kind == "impl_item" {
            node.child_by_field_name("type")
        } else {
            node.child_by_field_name("name")
        };
        if name_node.and_then(|n| node_text(n, source)).map(str::trim) == Some(name) {
            out.push(node);
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_container_nodes(child, source, name, out);
    }
}

/// Finds `member` declared inside a container named `container` (e.g. enum member `Active` of
/// `enum Status`, or `const MaxRetries` in `class Limits`).
pub fn extract_member_from_source(
    source: &str,
    file_path: &Path,
    rel_path: &str,
    container: &str,
    member: &str,
) -> Result<Option<ResolvedRepoSymbol>, String> {
    if is_vue_file(file_path) {
        return Ok(None);
    }
    let Some((lang_kind, language, lang_label)) = detect_language(file_path) else {
        return Ok(None);
    };

    let mut parser = Parser::new();
    parser
        .set_language(&language)
        .map_err(|e| format!("Failed to set tree-sitter language: {e}"))?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "tree-sitter failed to parse file".to_string())?;
    let bytes = source.as_bytes();

    let mut containers = Vec::new();
    collect_container_nodes(tree.root_node(), bytes, container, &mut containers);

    let lines: Vec<&str> = source.lines().collect();
    for node in containers {
        let found = match lang_kind {
            LangKind::TypeScript | LangKind::Tsx | LangKind::JavaScript => {
                find_ts_js_decl(node, bytes, member, None)
            }
            LangKind::Rust => find_rust_decl(node, bytes, member),
            LangKind::Python => find_python_decl(node, bytes, member, None),
            LangKind::CSharp => find_csharp_decl(node, bytes, member),
        };
        let Some(decl) = found else { continue };
        if decl.start_row >= lines.len() {
            continue;
        }
        return Ok(Some(ResolvedRepoSymbol {
            name: member.to_string(),
            kind: decl.kind.to_string(),
            path: rel_path.to_string(),
            line: decl.start_row + 1,
            language: lang_label.to_string(),
            doc_comment: extract_leading_doc_comment(&lines, decl.start_row),
            snippet: extract_snippet(&lines, decl.start_row, decl.end_row),
            total_lines: snippet_total_lines(&lines, decl.start_row, decl.end_row),
        }));
    }
    Ok(None)
}

fn is_vue_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("vue"))
        .unwrap_or(false)
}

fn to_pascal_case(name: &str) -> String {
    name.split(['-', '_'])
        .filter(|s| !s.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect()
}

fn vue_component_matches_symbol(file_path: &Path, symbol_name: &str) -> bool {
    let Some(stem) = file_path.file_stem().and_then(|s| s.to_str()) else {
        return false;
    };
    let effective_stem = if stem.eq_ignore_ascii_case("index") {
        file_path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or(stem)
    } else {
        stem
    };
    effective_stem.eq_ignore_ascii_case(symbol_name) || to_pascal_case(effective_stem) == symbol_name
}

struct VueScriptBlock {
    lang_kind: LangKind,
    language: Language,
    padded_source: String,
    start_row: usize,
}

fn extract_vue_script_blocks(source: &str) -> Vec<VueScriptBlock> {
    let lower = source.to_ascii_lowercase();
    let mut blocks = Vec::new();
    let mut search_from = 0;

    while let Some(rel_start) = lower[search_from..].find("<script") {
        let tag_start = search_from + rel_start;
        let Some(rel_tag_end) = lower[tag_start..].find('>') else {
            break;
        };
        let open_tag_end = tag_start + rel_tag_end + 1;
        let open_tag = &lower[tag_start..open_tag_end];

        let Some(rel_close) = lower[open_tag_end..].find("</script>") else {
            break;
        };
        let body_end = open_tag_end + rel_close;
        let body = &source[open_tag_end..body_end];

        let (lang_kind, language): (LangKind, Language) =
            if open_tag.contains("lang=\"tsx\"") || open_tag.contains("lang='tsx'") {
                (LangKind::Tsx, tree_sitter_typescript::LANGUAGE_TSX.into())
            } else if open_tag.contains("lang=\"ts\"") || open_tag.contains("lang='ts'") {
                (
                    LangKind::TypeScript,
                    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
                )
            } else {
                (LangKind::JavaScript, tree_sitter_javascript::LANGUAGE.into())
            };

        let start_row = source[..tag_start].bytes().filter(|&b| b == b'\n').count();
        let body_start_row = source[..open_tag_end].bytes().filter(|&b| b == b'\n').count();
        let mut padded_source = "\n".repeat(body_start_row);
        padded_source.push_str(body);

        blocks.push(VueScriptBlock {
            lang_kind,
            language,
            padded_source,
            start_row,
        });

        search_from = body_end + "</script>".len();
    }

    blocks
}

fn extract_vue_html_doc_comment(lines: &[&str], tag_row: usize) -> Option<String> {
    if tag_row == 0 {
        return None;
    }
    let mut i = tag_row - 1;
    if lines.get(i).map(|l| l.trim().is_empty()).unwrap_or(true) {
        return None;
    }
    if !lines[i].trim().ends_with("-->") {
        return None;
    }
    let mut collected = Vec::new();
    loop {
        collected.push(lines[i]);
        if lines[i].trim().starts_with("<!--") || i == 0 {
            break;
        }
        i -= 1;
    }
    collected.reverse();
    Some(collected.join("\n").trim().to_string())
}

fn extract_vue_symbol(
    source: &str,
    file_path: &Path,
    rel_path: &str,
    symbol_name: &str,
    allow_component_fallback: bool,
) -> Result<Option<ResolvedRepoSymbol>, String> {
    let lines: Vec<&str> = source.lines().collect();
    let blocks = extract_vue_script_blocks(source);

    for block in &blocks {
        let mut parser = Parser::new();
        parser
            .set_language(&block.language)
            .map_err(|e| format!("Failed to set tree-sitter language: {e}"))?;

        if let Some(tree) = parser.parse(&block.padded_source, None) {
            let root = tree.root_node();
            let bytes = block.padded_source.as_bytes();
            let _ = block.lang_kind;
            if let Some(decl) = find_ts_js_decl(root, bytes, symbol_name, None) {
                if decl.start_row < lines.len() {
                    return Ok(Some(ResolvedRepoSymbol {
                        name: symbol_name.to_string(),
                        kind: decl.kind.to_string(),
                        path: rel_path.to_string(),
                        line: decl.start_row + 1,
                        language: "vue".to_string(),
                        doc_comment: extract_leading_doc_comment(&lines, decl.start_row),
                        snippet: extract_snippet(&lines, decl.start_row, decl.end_row),
                        total_lines: snippet_total_lines(&lines, decl.start_row, decl.end_row),
                    }));
                }
            }
        }
    }

    if allow_component_fallback || vue_component_matches_symbol(file_path, symbol_name) {
        let start_row = blocks.first().map(|b| b.start_row).unwrap_or(0);
        let end_row = lines
            .iter()
            .enumerate()
            .skip(start_row)
            .find(|(_, l)| l.trim_start().to_ascii_lowercase().starts_with("</script"))
            .map(|(i, _)| i)
            .unwrap_or_else(|| lines.len().saturating_sub(1));
        if start_row < lines.len() {
            let doc_comment = extract_vue_html_doc_comment(&lines, start_row)
                .or_else(|| extract_leading_doc_comment(&lines, start_row));
            return Ok(Some(ResolvedRepoSymbol {
                name: symbol_name.to_string(),
                kind: "component".to_string(),
                path: rel_path.to_string(),
                line: start_row + 1,
                language: "vue".to_string(),
                doc_comment,
                snippet: extract_snippet(&lines, start_row, end_row),
                total_lines: snippet_total_lines(&lines, start_row, end_row),
            }));
        }
    }

    Ok(None)
}

/// Parses `source` with `tree-sitter` and extracts the matching declaration for `symbol_name`.
pub fn extract_symbol_from_source(
    source: &str,
    file_path: &Path,
    rel_path: &str,
    symbol_name: &str,
) -> Result<Option<ResolvedRepoSymbol>, String> {
    if is_vue_file(file_path) {
        return extract_vue_symbol(source, file_path, rel_path, symbol_name, false);
    }

    let Some((lang_kind, language, lang_label)) = detect_language(file_path) else {
        return Ok(None);
    };

    let mut parser = Parser::new();
    parser
        .set_language(&language)
        .map_err(|e| format!("Failed to set tree-sitter language: {e}"))?;

    let tree = parser
        .parse(source, None)
        .ok_or_else(|| "tree-sitter failed to parse file".to_string())?;

    let root = tree.root_node();
    let bytes = source.as_bytes();

    let found = match lang_kind {
        LangKind::TypeScript | LangKind::Tsx | LangKind::JavaScript => {
            find_ts_js_decl(root, bytes, symbol_name, None)
        }
        LangKind::Rust => find_rust_decl(root, bytes, symbol_name),
        LangKind::Python => find_python_decl(root, bytes, symbol_name, None),
        LangKind::CSharp => find_csharp_decl(root, bytes, symbol_name),
    };

    let Some(decl) = found else {
        return Ok(None);
    };

    let lines: Vec<&str> = source.lines().collect();
    if decl.start_row >= lines.len() {
        return Ok(None);
    }

    Ok(Some(ResolvedRepoSymbol {
        name: symbol_name.to_string(),
        kind: decl.kind.to_string(),
        path: rel_path.to_string(),
        line: decl.start_row + 1,
        language: lang_label.to_string(),
        doc_comment: extract_leading_doc_comment(&lines, decl.start_row),
        snippet: extract_snippet(&lines, decl.start_row, decl.end_row),
        total_lines: snippet_total_lines(&lines, decl.start_row, decl.end_row),
    }))
}

fn find_ts_reexport_targets(source: &str, symbol_name: &str) -> Vec<(String, String)> {
    let mut targets = Vec::new();
    for line in source.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("export ") || !trimmed.contains(" from ") {
            continue;
        }
        let Some(from_idx) = trimmed.find(" from ") else {
            continue;
        };
        let export_clause = &trimmed["export ".len()..from_idx];
        let Some(spec) = extract_quoted_literal(&trimmed[from_idx + 6..]) else {
            continue;
        };

        if export_clause.trim().starts_with('*') {
            targets.push((spec.to_string(), symbol_name.to_string()));
            continue;
        }

        if let (Some(open), Some(close)) = (export_clause.find('{'), export_clause.find('}')) {
            let inside = &export_clause[open + 1..close];
            for item in inside.split(',') {
                let item = item.trim().trim_start_matches("type ").trim();
                if item.is_empty() {
                    continue;
                }
                if let Some((orig, alias)) = item.split_once(" as ") {
                    if alias.trim() == symbol_name {
                        let orig_name = orig.trim();
                        let lookup = if orig_name == "default" {
                            symbol_name
                        } else {
                            orig_name
                        };
                        targets.push((spec.to_string(), lookup.to_string()));
                    }
                } else if item == symbol_name {
                    targets.push((spec.to_string(), symbol_name.to_string()));
                }
            }
        }
    }
    targets
}

fn resolve_symbol_in_file(
    canonical_root: &Path,
    target_file: &Path,
    symbol_name: &str,
    container: Option<&str>,
    from_explicit_import: bool,
    visited: &mut HashSet<PathBuf>,
    depth: usize,
) -> Result<Option<ResolvedRepoSymbol>, String> {
    if depth > 3 || !visited.insert(target_file.to_path_buf()) {
        return Ok(None);
    }

    let rel_path = target_file
        .strip_prefix(canonical_root)
        .map(normalize_slashes)
        .unwrap_or_else(|_| normalize_slashes(target_file));

    let source = fs::read_to_string(target_file)
        .map_err(|e| format!("Failed to read {}: {e}", rel_path))?;

    if let Some(container) = container {
        if let Some(found) =
            extract_member_from_source(&source, target_file, &rel_path, container, symbol_name)?
        {
            return Ok(Some(found));
        }
    } else if is_vue_file(target_file) {
        return extract_vue_symbol(
            &source,
            target_file,
            &rel_path,
            symbol_name,
            from_explicit_import,
        );
    } else if let Some(found) =
        extract_symbol_from_source(&source, target_file, &rel_path, symbol_name)?
    {
        return Ok(Some(found));
    }

    // Barrels re-export the container (e.g. the enum), not its members.
    let reexported_name = container.unwrap_or(symbol_name);

    // Follow barrel re-exports in TS/JS files (e.g. `export { default as MyButton } from './MyButton.vue'`)
    let ext = target_file
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if matches!(
        ext.as_str(),
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs"
    ) {
        for (reexport_spec, next_symbol) in find_ts_reexport_targets(&source, reexported_name) {
            if let Some(next_file) =
                resolve_target_file(canonical_root, &rel_path, Some(&reexport_spec))
            {
                let (next_name, next_container) = match container {
                    Some(_) => (symbol_name, Some(next_symbol.as_str())),
                    None => (next_symbol.as_str(), None),
                };
                if let Some(found) = resolve_symbol_in_file(
                    canonical_root,
                    &next_file,
                    next_name,
                    next_container,
                    true,
                    visited,
                    depth + 1,
                )? {
                    return Ok(Some(found));
                }
            }
        }
    }

    Ok(None)
}

#[tauri::command]
pub fn resolve_repo_symbol(
    request: ResolveRepoSymbolRequest,
) -> Result<Option<ResolvedRepoSymbol>, String> {
    let repo_root = Path::new(&request.repo_path);
    if !repo_root.is_dir() {
        return Err(format!(
            "Repository path does not exist or is not a directory: {}",
            request.repo_path
        ));
    }

    let canonical_root = repo_root
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize repo path: {e}"))?;

    let container = request
        .container
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if let Some(target) = request
        .target_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let Ok(target_file) = canonical_root.join(target).canonicalize() else {
            return Ok(None);
        };
        if !target_file.starts_with(&canonical_root) || !target_file.is_file() {
            return Ok(None);
        }
        let mut visited = HashSet::new();
        return resolve_symbol_in_file(
            &canonical_root,
            &target_file,
            &request.symbol_name,
            container,
            true,
            &mut visited,
            0,
        );
    }

    let target_file = resolve_target_file(
        &canonical_root,
        &request.importer_path,
        request.import_specifier.as_deref(),
    )
    .or_else(|| {
        resolve_csharp_symbol_file(
            &canonical_root,
            &request.importer_path,
            request.import_specifier.as_deref(),
            container.unwrap_or(&request.symbol_name),
        )
    });

    let Some(target_file) = target_file else {
        return Ok(None);
    };

    let from_explicit_import = request
        .import_specifier
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let mut visited = HashSet::new();

    resolve_symbol_in_file(
        &canonical_root,
        &target_file,
        &request.symbol_name,
        container,
        from_explicit_import,
        &mut visited,
        0,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_typescript_interface_with_doc_comment() {
        let src = r#"
/**
 * Configuration for retry backoff.
 */
export interface RetryPolicy {
  maxAttempts: number
  baseDelayMs: number
}
"#;
        let res = extract_symbol_from_source(
            src,
            Path::new("src/types/webhook.ts"),
            "src/types/webhook.ts",
            "RetryPolicy",
        )
        .unwrap()
        .expect("should find RetryPolicy");

        assert_eq!(res.kind, "interface");
        assert_eq!(res.line, 5);
        assert_eq!(res.language, "typescript");
        assert!(res
            .doc_comment
            .as_deref()
            .unwrap()
            .contains("Configuration for retry backoff."));
        assert!(res.snippet.contains("export interface RetryPolicy"));
    }

    #[test]
    fn returns_full_declaration_and_total_lines_for_long_bodies() {
        let body: String = (0..30).map(|i| format!("  const v{i} = {i}\n")).collect();
        let src = format!("export function big() {{\n{body}}}\n\nexport const other = 1\n");
        let res = extract_symbol_from_source(&src, Path::new("a.ts"), "a.ts", "big")
            .unwrap()
            .expect("should find big");
        assert_eq!(res.total_lines, 32);
        assert_eq!(res.snippet.lines().count(), 32);
        assert!(res.snippet.ends_with('}'));
    }

    #[test]
    fn extracts_rust_struct_and_fn() {
        let src = r#"
/// Blame metadata for a single line.
pub struct GitBlameInfo {
    pub short_oid: String,
}

pub fn parse_porcelain_blame(stdout: &str) -> bool {
    !stdout.is_empty()
}
"#;
        let s = extract_symbol_from_source(src, Path::new("git.rs"), "git.rs", "GitBlameInfo")
            .unwrap()
            .expect("should find GitBlameInfo");
        assert_eq!(s.kind, "struct");
        assert_eq!(s.line, 3);
        assert!(s
            .doc_comment
            .as_deref()
            .unwrap()
            .contains("Blame metadata for a single line."));

        let f = extract_symbol_from_source(
            src,
            Path::new("git.rs"),
            "git.rs",
            "parse_porcelain_blame",
        )
        .unwrap()
        .expect("should find fn");
        assert_eq!(f.kind, "fn");
        assert_eq!(f.line, 7);
    }

    #[test]
    fn extracts_python_def() {
        let src = r#"
# Compute exponential backoff
def compute_delay(attempt: int) -> float:
    return 0.5 * (2 ** attempt)
"#;
        let res = extract_symbol_from_source(
            src,
            Path::new("backoff.py"),
            "backoff.py",
            "compute_delay",
        )
        .unwrap()
        .expect("should find def");
        assert_eq!(res.kind, "def");
        assert_eq!(res.line, 3);
        assert_eq!(res.doc_comment.as_deref(), Some("# Compute exponential backoff"));
    }

    #[test]
    fn extracts_csharp_declarations_and_xml_doc_comments() {
        let src = r#"
namespace Stroll.Orders;

/// <summary>
/// Represents an immutable order summary.
/// </summary>
public sealed record OrderSummary(string Id, decimal Total);

/// <summary>
/// Contract for processing orders.
/// </summary>
public interface IOrderService
{
    Task<OrderSummary> CreateAsync(string id);
}

public enum OrderStatus
{
    Pending,
    Completed
}

public struct MoneyAmount
{
    public decimal Value;
}

/// <summary>
/// Processes customer orders.
/// </summary>
public sealed class OrderService : IOrderService
{
    public async Task<OrderSummary> CreateAsync(string id)
    {
        return new OrderSummary(id, 42m);
    }

    /// <summary>Validates and calculates total.</summary>
    public decimal CalculateTotal(decimal subtotal)
    {
        return subtotal * 1.1m;
    }
}
"#;
        let rec = extract_symbol_from_source(
            src,
            Path::new("src/Orders/OrderService.cs"),
            "src/Orders/OrderService.cs",
            "OrderSummary",
        )
        .unwrap()
        .expect("should find record OrderSummary");
        assert_eq!(rec.kind, "record");
        assert_eq!(rec.language, "csharp");
        assert!(rec
            .doc_comment
            .as_deref()
            .unwrap()
            .contains("immutable order summary"));

        let iface = extract_symbol_from_source(
            src,
            Path::new("src/Orders/OrderService.cs"),
            "src/Orders/OrderService.cs",
            "IOrderService",
        )
        .unwrap()
        .expect("should find interface IOrderService");
        assert_eq!(iface.kind, "interface");
        assert!(iface
            .doc_comment
            .as_deref()
            .unwrap()
            .contains("Contract for processing orders."));

        let en = extract_symbol_from_source(
            src,
            Path::new("src/Orders/OrderService.cs"),
            "src/Orders/OrderService.cs",
            "OrderStatus",
        )
        .unwrap()
        .expect("should find enum OrderStatus");
        assert_eq!(en.kind, "enum");

        let st = extract_symbol_from_source(
            src,
            Path::new("src/Orders/OrderService.cs"),
            "src/Orders/OrderService.cs",
            "MoneyAmount",
        )
        .unwrap()
        .expect("should find struct MoneyAmount");
        assert_eq!(st.kind, "struct");

        let cls = extract_symbol_from_source(
            src,
            Path::new("src/Orders/OrderService.cs"),
            "src/Orders/OrderService.cs",
            "OrderService",
        )
        .unwrap()
        .expect("should find class OrderService");
        assert_eq!(cls.kind, "class");
        assert!(cls
            .doc_comment
            .as_deref()
            .unwrap()
            .contains("Processes customer orders."));

        let method = extract_symbol_from_source(
            src,
            Path::new("src/Orders/OrderService.cs"),
            "src/Orders/OrderService.cs",
            "CalculateTotal",
        )
        .unwrap()
        .expect("should find method CalculateTotal");
        assert_eq!(method.kind, "method");
        assert!(method
            .doc_comment
            .as_deref()
            .unwrap()
            .contains("Validates and calculates total."));
    }

    #[test]
    fn resolves_csharp_repo_symbol_by_namespace() {
        let tmp = std::env::temp_dir().join(format!(
            "stroll_cs_ast_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("src/Services")).unwrap();
        fs::create_dir_all(tmp.join("src/Controllers")).unwrap();

        fs::write(
            tmp.join("src/Services/OrderService.cs"),
            "namespace MyApp.Services;\n\n/// <summary>Order service</summary>\npublic class OrderService {}\n",
        )
        .unwrap();
        fs::write(
            tmp.join("src/Controllers/OrdersController.cs"),
            "using MyApp.Services;\npublic class OrdersController {}\n",
        )
        .unwrap();

        let res = resolve_repo_symbol(ResolveRepoSymbolRequest {
            repo_path: tmp.to_string_lossy().to_string(),
            importer_path: "src/Controllers/OrdersController.cs".to_string(),
            symbol_name: "OrderService".to_string(),
            import_specifier: Some("MyApp.Services".to_string()),
            target_path: None,
            container: None,
        })
        .unwrap()
        .expect("should resolve OrderService across C# namespace");

        assert_eq!(res.name, "OrderService");
        assert_eq!(res.kind, "class");
        assert_eq!(res.language, "csharp");
        assert_eq!(res.path, "src/Services/OrderService.cs");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolves_csharp_symbol_from_explicit_target_path() {
        let tmp = std::env::temp_dir().join(format!(
            "stroll_cs_target_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("src/MyApp.Domain/Services/Billing")).unwrap();
        fs::create_dir_all(tmp.join("src/MyApp.Host")).unwrap();
        fs::write(
            tmp.join("src/MyApp.Domain/Services/Billing/Contracts.cs"),
            "namespace MyApp.Domain.Services.Billing;\n\npublic class Invoice {}\n\n/// <summary>Bills things</summary>\npublic interface IBillingService {}\n",
        )
        .unwrap();
        fs::write(
            tmp.join("src/MyApp.Host/Startup.cs"),
            "using MyApp.Domain.Services.Billing;\npublic static class Startup {}\n",
        )
        .unwrap();

        let request = |target: &str| ResolveRepoSymbolRequest {
            repo_path: tmp.to_string_lossy().to_string(),
            importer_path: "src/MyApp.Host/Startup.cs".to_string(),
            symbol_name: "IBillingService".to_string(),
            import_specifier: Some("MyApp.Domain.Services.Billing".to_string()),
            target_path: Some(target.to_string()),
            container: None,
        };

        let res = resolve_repo_symbol(request("src/MyApp.Domain/Services/Billing/Contracts.cs"))
            .unwrap()
            .expect("should resolve type declared in a differently named file");
        assert_eq!(res.kind, "interface");
        assert_eq!(res.path, "src/MyApp.Domain/Services/Billing/Contracts.cs");
        assert!(res.doc_comment.as_deref().unwrap().contains("Bills things"));

        // Paths escaping the repo root are rejected.
        assert!(resolve_repo_symbol(request("../outside.cs")).unwrap().is_none());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn extracts_csharp_constant_fields_and_enum_members() {
        let src = r#"
namespace Stroll.Limits;

public static class RetryLimits
{
    /// <summary>Maximum attempts.</summary>
    public const int MaxRetries = 5;
    public static readonly TimeSpan Backoff = TimeSpan.FromSeconds(2);
    public static int Mutable = 3;
}

public enum OrderStatus
{
    Pending = 1,
    Completed
}
"#;
        let path = Path::new("src/Limits.cs");
        let max = extract_member_from_source(src, path, "src/Limits.cs", "RetryLimits", "MaxRetries")
            .unwrap()
            .expect("const field");
        assert_eq!(max.kind, "const");
        assert_eq!(max.line, 7);
        assert!(max.snippet.contains("MaxRetries = 5"));
        assert!(max.doc_comment.as_deref().unwrap().contains("Maximum attempts"));

        let backoff = extract_member_from_source(src, path, "src/Limits.cs", "RetryLimits", "Backoff")
            .unwrap()
            .expect("static readonly field");
        assert_eq!(backoff.kind, "const");

        // Mutable statics are not constants.
        assert!(extract_member_from_source(src, path, "src/Limits.cs", "RetryLimits", "Mutable")
            .unwrap()
            .is_none());

        let completed =
            extract_member_from_source(src, path, "src/Limits.cs", "OrderStatus", "Completed")
                .unwrap()
                .expect("enum member");
        assert_eq!(completed.kind, "enumMember");
        assert_eq!(completed.snippet.trim(), "Completed");

        // Members are only found inside the named container.
        assert!(extract_member_from_source(src, path, "src/Limits.cs", "OrderStatus", "MaxRetries")
            .unwrap()
            .is_none());

        // Bare lookup also finds constant fields now.
        let bare = extract_symbol_from_source(src, path, "src/Limits.cs", "MaxRetries")
            .unwrap()
            .expect("bare const field");
        assert_eq!(bare.kind, "const");
    }

    #[test]
    fn extracts_enum_members_and_associated_consts_for_ts_rust_python() {
        let ts = "export enum Status {\n  Active = 2,\n  Inactive,\n}\n";
        let m = extract_member_from_source(ts, Path::new("a.ts"), "a.ts", "Status", "Inactive")
            .unwrap()
            .expect("ts bare enum member");
        assert_eq!((m.kind.as_str(), m.line), ("enumMember", 3));
        let m = extract_member_from_source(ts, Path::new("a.ts"), "a.ts", "Status", "Active")
            .unwrap()
            .expect("ts assigned enum member");
        assert_eq!(m.snippet.trim(), "Active = 2,");

        let rs = "pub enum Mode {\n    Fast = 1,\n    Slow,\n}\n\npub struct Limits;\n\nimpl Limits {\n    pub const MAX: u32 = 10;\n}\n";
        let m = extract_member_from_source(rs, Path::new("a.rs"), "a.rs", "Mode", "Slow")
            .unwrap()
            .expect("rust variant");
        assert_eq!(m.kind, "enumMember");
        let m = extract_member_from_source(rs, Path::new("a.rs"), "a.rs", "Limits", "MAX")
            .unwrap()
            .expect("rust associated const via impl");
        assert_eq!((m.kind.as_str(), m.line), ("const", 9));

        let py = "from enum import Enum\n\nclass Color(Enum):\n    RED = 1\n    GREEN = 2\n";
        let m = extract_member_from_source(py, Path::new("a.py"), "a.py", "Color", "GREEN")
            .unwrap()
            .expect("python enum member");
        assert_eq!((m.kind.as_str(), m.line), ("const", 5));
    }

    #[test]
    fn extracts_vue_sfc_script_setup_symbols_and_component() {
        let src = r#"<template>
  <button>{{ label }}</button>
</template>

<!-- Reusable primary button -->
<script setup lang="ts">
/**
 * Props for PrimaryButton.
 */
export interface ButtonProps {
  label: string
}

const props = defineProps<ButtonProps>()
</script>
"#;
        let iface = extract_symbol_from_source(
            src,
            Path::new("src/components/PrimaryButton.vue"),
            "src/components/PrimaryButton.vue",
            "ButtonProps",
        )
        .unwrap()
        .expect("should find ButtonProps inside <script setup lang=\"ts\">");
        assert_eq!(iface.kind, "interface");
        assert_eq!(iface.language, "vue");
        assert_eq!(iface.line, 10);
        assert!(iface
            .doc_comment
            .as_deref()
            .unwrap()
            .contains("Props for PrimaryButton."));

        let comp = extract_symbol_from_source(
            src,
            Path::new("src/components/PrimaryButton.vue"),
            "src/components/PrimaryButton.vue",
            "PrimaryButton",
        )
        .unwrap()
        .expect("should resolve PrimaryButton component");
        assert_eq!(comp.kind, "component");
        assert_eq!(comp.language, "vue");
        assert_eq!(comp.line, 6);
        assert!(comp
            .doc_comment
            .as_deref()
            .unwrap()
            .contains("Reusable primary button"));
    }

    #[test]
    fn resolves_vue_aliases_from_tsconfig_vite_monorepo_and_barrels() {
        let tmp = std::env::temp_dir().join(format!(
            "stroll_vue_alias_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);

        // Monorepo layout: apps/web/ with tsconfig.json -> references tsconfig.app.json
        let web_root = tmp.join("apps/web");
        fs::create_dir_all(web_root.join("src/components/ui")).unwrap();
        fs::create_dir_all(web_root.join("src/composables")).unwrap();
        fs::create_dir_all(web_root.join("src/views")).unwrap();

        fs::write(
            web_root.join("tsconfig.json"),
            r#"{
  // Root tsconfig with project reference (create-vue style)
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
  ],
}"#,
        )
        .unwrap();

        fs::write(
            web_root.join("tsconfig.app.json"),
            r#"{
  /* App paths */
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@ui/*": ["./src/components/ui/*"],
    },
  }
}"#,
        )
        .unwrap();

        fs::write(
            web_root.join("vite.config.ts"),
            r#"import { fileURLToPath, URL } from 'node:url'
export default {
  resolve: {
    alias: {
      '~composables': fileURLToPath(new URL('./src/composables', import.meta.url)),
    },
  },
}"#,
        )
        .unwrap();

        fs::write(
            web_root.join("src/components/ui/ActionCard.vue"),
            "<script setup lang=\"ts\">\ndefineProps<{ title: string }>()\n</script>\n<template><div /></template>\n",
        )
        .unwrap();

        fs::write(
            web_root.join("src/components/ui/index.ts"),
            "export { default as ActionCard } from './ActionCard.vue'\n",
        )
        .unwrap();

        fs::write(
            web_root.join("src/composables/useSession.ts"),
            "/** Returns current user session. */\nexport function useSession() {\n  return { active: true }\n}\n",
        )
        .unwrap();

        fs::write(
            web_root.join("src/views/HomeView.vue"),
            "<script setup lang=\"ts\">\nimport ActionCard from '@ui/ActionCard.vue'\nimport { useSession } from '~composables/useSession'\n</script>\n",
        )
        .unwrap();

        // 1. Custom `@ui/ActionCard.vue` via tsconfig.json -> references -> tsconfig.app.json
        let card = resolve_repo_symbol(ResolveRepoSymbolRequest {
            repo_path: tmp.to_string_lossy().to_string(),
            importer_path: "apps/web/src/views/HomeView.vue".to_string(),
            symbol_name: "ActionCard".to_string(),
            import_specifier: Some("@ui/ActionCard.vue".to_string()),
            target_path: None,
            container: None,
        })
        .unwrap()
        .expect("should resolve @ui/ActionCard.vue via tsconfig.app.json");
        assert_eq!(card.kind, "component");
        assert_eq!(card.language, "vue");
        assert_eq!(card.path, "apps/web/src/components/ui/ActionCard.vue");

        // 2. Barrel re-export `@/components/ui` -> `index.ts` -> `ActionCard.vue`
        let barrel = resolve_repo_symbol(ResolveRepoSymbolRequest {
            repo_path: tmp.to_string_lossy().to_string(),
            importer_path: "apps/web/src/views/HomeView.vue".to_string(),
            symbol_name: "ActionCard".to_string(),
            import_specifier: Some("@/components/ui".to_string()),
            target_path: None,
            container: None,
        })
        .unwrap()
        .expect("should resolve ActionCard through barrel index.ts");
        assert_eq!(barrel.path, "apps/web/src/components/ui/ActionCard.vue");

        // 3. Vite config `~composables/useSession`
        let composable = resolve_repo_symbol(ResolveRepoSymbolRequest {
            repo_path: tmp.to_string_lossy().to_string(),
            importer_path: "apps/web/src/views/HomeView.vue".to_string(),
            symbol_name: "useSession".to_string(),
            import_specifier: Some("~composables/useSession".to_string()),
            target_path: None,
            container: None,
        })
        .unwrap()
        .expect("should resolve ~composables/useSession via vite.config.ts");
        assert_eq!(composable.kind, "function");
        assert_eq!(composable.path, "apps/web/src/composables/useSession.ts");

        let _ = fs::remove_dir_all(&tmp);
    }
}
