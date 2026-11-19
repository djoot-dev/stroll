import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDiffSegments, isPureRename } from '@/services/diffParser'
import {
  detectLanguage,
  fetchRestPRFiles,
  isBinaryFilePath,
  isImageFilePath,
} from '@/services/github'
import { highlightLinesWithCodeMirror } from '@/services/highlighter'
import * as httpModule from '@/services/http'
import type { PRFile } from '@/types/pr'

describe('detectLanguage & CodeMirror highlighting', () => {
  it('detects C# and all newly added language extensions', () => {
    expect(detectLanguage('src/Services/OrderService.cs')).toBe('csharp')
    expect(detectLanguage('cmd/server/main.go')).toBe('go')
    expect(detectLanguage('src/Main.java')).toBe('java')
    expect(detectLanguage('include/engine.hpp')).toBe('cpp')
    expect(detectLanguage('src/engine.cpp')).toBe('cpp')
    expect(detectLanguage('src/util.c')).toBe('cpp')
    expect(detectLanguage('app/Http/Controller.php')).toBe('php')
    expect(detectLanguage('Orders.csproj')).toBe('xml')
    expect(detectLanguage('Directory.Build.props')).toBe('xml')
    expect(detectLanguage('build/custom.targets')).toBe('xml')
    expect(detectLanguage('assets/logo.svg')).toBe('xml')
    expect(detectLanguage('Info.plist')).toBe('xml')
    expect(detectLanguage('styles/theme.scss')).toBe('scss')
    expect(detectLanguage('styles/theme.sass')).toBe('sass')
    expect(detectLanguage('scripts/deploy.sh')).toBe('shell')
    expect(detectLanguage('scripts/setup.zsh')).toBe('shell')
    expect(detectLanguage('Rakefile.rb')).toBe('ruby')
    expect(detectLanguage('Sources/App.swift')).toBe('swift')
    expect(detectLanguage('src/Main.kt')).toBe('kotlin')
    expect(detectLanguage('Cargo.toml')).toBe('toml')
    expect(detectLanguage('Dockerfile')).toBe('dockerfile')
    expect(detectLanguage('Dockerfile.prod')).toBe('dockerfile')
  })

  it('produces styled CodeMirror spans for C# and newly added languages', () => {
    const samples: Array<{ language: string; lines: string[] }> = [
      { language: 'csharp', lines: ['public sealed class OrderService { public int Count => 42; }'] },
      { language: 'go', lines: ['package main', 'func main() { println("hello") }'] },
      { language: 'java', lines: ['public class Main { public static void main(String[] args) {} }'] },
      { language: 'cpp', lines: ['#include <vector>', 'int main() { return 0; }'] },
      { language: 'php', lines: ['<?php function greet(string $name): string { return $name; }'] },
      { language: 'xml', lines: ['<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup /></Project>'] },
      { language: 'scss', lines: ['$primary: #c86130; .btn { color: $primary; }'] },
      { language: 'shell', lines: ['#!/usr/bin/env bash', 'echo "hello"'] },
      { language: 'ruby', lines: ['def greet(name); puts name; end'] },
      { language: 'swift', lines: ['struct User { let id: Int }'] },
      { language: 'kotlin', lines: ['data class User(val id: Int)'] },
      { language: 'toml', lines: ['[package]', 'name = "stroll"'] },
      { language: 'dockerfile', lines: ['FROM node:22-alpine', 'WORKDIR /app'] },
    ]

    for (const { language, lines } of samples) {
      const highlighted = highlightLinesWithCodeMirror(lines, language)
      expect(highlighted.length).toBe(lines.length)
      const hasStyledSpan = highlighted.some((lineSpans) =>
        lineSpans.some((sp) => sp.className.length > 0),
      )
      expect(hasStyledSpan, `Expected styled tokens for language "${language}"`).toBe(true)
    }
  })
})

describe('pure rename & binary diff segment handling', () => {
  it('identifies pure renames and returns empty diff segments', () => {
    const pureRename: PRFile = {
      path: 'src/services/newName.ts',
      previousPath: 'src/services/oldName.ts',
      status: 'renamed',
      additions: 0,
      deletions: 0,
      patch: '',
      baseContent: 'export const x = 1\n',
      headContent: 'export const x = 1\n',
      language: 'typescript',
    }
    expect(isPureRename(pureRename)).toBe(true)
    expect(buildDiffSegments(pureRename)).toEqual([])
  })

  it('detects binary/image files and suppresses fake textual segments', () => {
    expect(isImageFilePath('assets/hero.png')).toBe(true)
    expect(isImageFilePath('assets/logo.svg')).toBe(true)
    expect(isBinaryFilePath('assets/hero.png')).toBe(true)
    expect(isBinaryFilePath('docs/spec.pdf')).toBe(true)
    expect(isBinaryFilePath('fonts/inter.woff2')).toBe(true)
    expect(isBinaryFilePath('src/App.vue')).toBe(false)

    const binaryFile: PRFile = {
      path: 'docs/spec.pdf',
      status: 'added',
      additions: 0,
      deletions: 0,
      patch: '',
      baseContent: null,
      headContent: null,
      language: 'text',
      isBinary: true,
    }
    expect(buildDiffSegments(binaryFile)).toEqual([])
  })
})

describe('fetchRestPRFiles pagination', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('follows Link rel="next" headers across multiple pages', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `src/file_${i + 1}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0,
    }))
    const page2 = Array.from({ length: 35 }, (_, i) => ({
      filename: `src/file_${i + 101}.ts`,
      status: 'added',
      additions: 5,
      deletions: 0,
    }))

    const fetchSpy = vi
      .spyOn(httpModule, 'httpFetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page1), {
          status: 200,
          headers: {
            Link: '<https://api.github.com/repos/acme/app/pulls/7/files?per_page=100&page=2>; rel="next", <https://api.github.com/repos/acme/app/pulls/7/files?per_page=100&page=2>; rel="last"',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page2), {
          status: 200,
          headers: {
            Link: '<https://api.github.com/repos/acme/app/pulls/7/files?per_page=100&page=1>; rel="prev"',
          },
        }),
      )

    const files = await fetchRestPRFiles('fake-pat', 'acme', 'app', 7)
    expect(files.length).toBe(135)
    expect(files[0].filename).toBe('src/file_1.ts')
    expect(files[134].filename).toBe('src/file_135.ts')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('respects the maxFiles safety cap during pagination', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      filename: `src/f_${i}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0,
    }))

    const fetchSpy = vi.spyOn(httpModule, 'httpFetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(fullPage), {
          status: 200,
        }),
    )

    const files = await fetchRestPRFiles('fake-pat', 'acme', 'app', 9, 250)
    expect(files.length).toBe(250)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})
