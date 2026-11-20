//! Repository-wide C# type index.
//!
//! C# `using` directives import *namespaces*, not files, and .NET solutions rarely mirror
//! namespaces onto folders (e.g. `MyApp.Domain.Services` usually lives at
//! `src/MyApp.Domain/Services/`). Instead of guessing paths, we scan every `.cs` file once
//! and record which types it declares and in which namespace. The frontend uses this to
//! decide which identifiers are hoverable and which file to resolve them from.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexCSharpTypesRequest {
    pub repo_path: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CSharpTypeEntry {
    pub name: String,
    pub namespace: Option<String>,
    /// Repo-relative path using forward slashes.
    pub path: String,
}

const SKIP_DIRS: &[&str] = &["bin", "obj", "node_modules", "packages", "target", "dist"];
const MAX_FILES: usize = 50_000;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

const MODIFIERS: &[&str] = &[
    "public", "internal", "private", "protected", "static", "sealed", "partial", "abstract",
    "readonly", "ref", "new", "unsafe", "file",
];

fn is_ident_start(c: char) -> bool {
    c == '_' || c.is_alphabetic()
}

fn is_ident_char(c: char) -> bool {
    c == '_' || c.is_alphanumeric()
}

fn take_ident(s: &str) -> Option<(&str, &str)> {
    let mut chars = s.char_indices();
    let (_, first) = chars.next()?;
    if !is_ident_start(first) {
        return None;
    }
    let end = chars
        .find(|(_, c)| !is_ident_char(*c))
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    Some((&s[..end], &s[end..]))
}

fn take_dotted_name(s: &str) -> Option<&str> {
    let end = s
        .char_indices()
        .find(|(_, c)| !(is_ident_char(*c) || *c == '.'))
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    let name = s[..end].trim_end_matches('.');
    if name.is_empty() || !name.starts_with(is_ident_start) {
        None
    } else {
        Some(name)
    }
}

/// Strips leading `[Attribute]` groups that share a line with the declaration.
fn strip_leading_attributes(mut s: &str) -> &str {
    while s.starts_with('[') {
        let mut depth = 0usize;
        let mut end = None;
        for (i, c) in s.char_indices() {
            match c {
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(i + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
        match end {
            Some(e) => s = s[e..].trim_start(),
            None => return s,
        }
    }
    s
}

/// Returns the declared type name if `line` starts a class/interface/struct/record/enum declaration.
fn parse_type_decl(line: &str) -> Option<&str> {
    let mut rest = strip_leading_attributes(line.trim_start());
    loop {
        let (word, after) = take_ident(rest)?;
        let after = after.trim_start();
        match word {
            w if MODIFIERS.contains(&w) => rest = after,
            "class" | "interface" | "struct" | "enum" => {
                return take_ident(after).map(|(name, _)| name);
            }
            "record" => {
                // `record Foo`, `record class Foo`, `record struct Foo`
                let (next, after_next) = take_ident(after)?;
                if next == "class" || next == "struct" {
                    return take_ident(after_next.trim_start()).map(|(name, _)| name);
                }
                return Some(next);
            }
            _ => return None,
        }
    }
}

fn parse_namespace_decl(line: &str) -> Option<&str> {
    let rest = line.trim_start().strip_prefix("namespace")?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    take_dotted_name(rest.trim_start())
}

/// Extracts `(type name, namespace)` pairs declared in a C# source file.
pub fn extract_csharp_types(source: &str) -> Vec<(String, Option<String>)> {
    let mut out = Vec::new();
    let mut namespace: Option<String> = None;
    let mut in_block_comment = false;

    for raw in source.lines() {
        let mut line = raw.trim();
        if in_block_comment {
            match line.find("*/") {
                Some(i) => {
                    in_block_comment = false;
                    line = line[i + 2..].trim();
                }
                None => continue,
            }
        }
        if line.starts_with("//") || line.is_empty() {
            continue;
        }
        if line.starts_with("/*") {
            if !line.contains("*/") {
                in_block_comment = true;
            }
            continue;
        }

        if let Some(ns) = parse_namespace_decl(line) {
            namespace = Some(ns.to_string());
            continue;
        }
        if let Some(name) = parse_type_decl(line) {
            out.push((name.to_string(), namespace.clone()));
        }
    }

    out
}

fn walk(dir: &Path, root: &Path, out: &mut Vec<CSharpTypeEntry>, file_count: &mut usize) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if *file_count >= MAX_FILES {
            return;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let path = entry.path();

        if file_type.is_dir() {
            if name.starts_with('.') || SKIP_DIRS.iter().any(|d| d.eq_ignore_ascii_case(&name)) {
                continue;
            }
            walk(&path, root, out, file_count);
        } else if file_type.is_file() && name.to_ascii_lowercase().ends_with(".cs") {
            *file_count += 1;
            if entry.metadata().map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(true) {
                continue;
            }
            let Ok(source) = fs::read_to_string(&path) else {
                continue;
            };
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            for (type_name, namespace) in extract_csharp_types(&source) {
                out.push(CSharpTypeEntry {
                    name: type_name,
                    namespace,
                    path: rel.clone(),
                });
            }
        }
    }
}

pub fn build_csharp_type_index(repo_root: &Path) -> Vec<CSharpTypeEntry> {
    let mut out = Vec::new();
    let mut file_count = 0usize;
    walk(repo_root, repo_root, &mut out, &mut file_count);
    out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));
    out
}

#[tauri::command]
pub async fn index_csharp_types(
    request: IndexCSharpTypesRequest,
) -> Result<Vec<CSharpTypeEntry>, String> {
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

    tauri::async_runtime::spawn_blocking(move || build_csharp_type_index(&canonical_root))
        .await
        .map_err(|e| format!("C# index task failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_types_with_block_and_file_scoped_namespaces() {
        let src = r#"
using System;

namespace MyApp.Domain.Orders
{
    /// <summary>Doc</summary>
    [Serializable]
    public sealed partial class OrderService : IOrderService
    {
        private class Nested {}
    }

    public interface IOrderService {}
    internal enum OrderState { Open }
    public record struct OrderId(int Value);
    public record OrderCreated(OrderId Id);
    // public class Commented {}
    /*
    public class InBlockComment {}
    */
}
"#;
        let types = extract_csharp_types(src);
        let names: Vec<&str> = types.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            vec!["OrderService", "Nested", "IOrderService", "OrderState", "OrderId", "OrderCreated"]
        );
        assert!(types
            .iter()
            .all(|(_, ns)| ns.as_deref() == Some("MyApp.Domain.Orders")));

        let file_scoped = extract_csharp_types("namespace MyApp.Web;\n\n[ApiController] public class HomeController {}\n");
        assert_eq!(
            file_scoped,
            vec![("HomeController".to_string(), Some("MyApp.Web".to_string()))]
        );
    }

    #[test]
    fn indexes_repo_with_dotted_project_folders_and_skips_build_output() {
        let tmp = std::env::temp_dir().join(format!("stroll_cs_index_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let svc_dir = tmp.join("src/MyApp.Domain/Services/Billing");
        fs::create_dir_all(&svc_dir).unwrap();
        fs::create_dir_all(tmp.join("src/MyApp.Domain/obj/Debug")).unwrap();
        fs::write(
            svc_dir.join("IBillingService.cs"),
            "namespace MyApp.Domain.Services.Billing;\npublic interface IBillingService {}\n",
        )
        .unwrap();
        fs::write(
            tmp.join("src/MyApp.Domain/obj/Debug/Generated.cs"),
            "public class Generated {}\n",
        )
        .unwrap();

        let index = build_csharp_type_index(&tmp.canonicalize().unwrap());
        assert_eq!(
            index,
            vec![CSharpTypeEntry {
                name: "IBillingService".to_string(),
                namespace: Some("MyApp.Domain.Services.Billing".to_string()),
                path: "src/MyApp.Domain/Services/Billing/IBillingService.cs".to_string(),
            }]
        );

        let _ = fs::remove_dir_all(&tmp);
    }
}
