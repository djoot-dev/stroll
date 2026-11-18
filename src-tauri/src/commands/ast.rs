use serde::{Deserialize, Serialize};
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
    pub snippet: String,
}

const SCRIPT_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "rs", "py", "vue",
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

/// Resolves an import specifier (relative, `@/` alias, or module path) to a file inside `repo_root`.
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

    // 2. `@/` alias (try `src/...` first, then repo root)
    if let Some(rest) = spec.strip_prefix("@/") {
        for base in [canonical_root.join("src").join(rest), canonical_root.join(rest)] {
            if let Some(found) = try_resolve_candidate(&canonical_root, &base) {
                return Some(found);
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum LangKind {
    TypeScript,
    Tsx,
    JavaScript,
    Rust,
    Python,
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
        _ => None,
    }
}

fn extract_leading_doc_comment(lines: &[&str], decl_row: usize) -> Option<String> {
    if decl_row == 0 {
        return None;
    }

    let mut i = decl_row - 1;
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

fn extract_snippet(lines: &[&str], start_row: usize, end_row: usize) -> String {
    let max_end = (start_row + 15).min(end_row).min(lines.len().saturating_sub(1));
    lines[start_row..=max_end].join("\n").trim_end().to_string()
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

/// Parses `source` with `tree-sitter` and extracts the matching declaration for `symbol_name`.
pub fn extract_symbol_from_source(
    source: &str,
    file_path: &Path,
    rel_path: &str,
    symbol_name: &str,
) -> Result<Option<ResolvedRepoSymbol>, String> {
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
    }))
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

    let Some(target_file) = resolve_target_file(
        &canonical_root,
        &request.importer_path,
        request.import_specifier.as_deref(),
    ) else {
        return Ok(None);
    };

    let rel_path = target_file
        .strip_prefix(&canonical_root)
        .map(normalize_slashes)
        .unwrap_or_else(|_| normalize_slashes(&target_file));

    let source = fs::read_to_string(&target_file)
        .map_err(|e| format!("Failed to read {}: {e}", rel_path))?;

    extract_symbol_from_source(&source, &target_file, &rel_path, &request.symbol_name)
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
}
