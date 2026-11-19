import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDiffSegments, isPureRename } from '@/services/diffParser'
import {
  detectLanguage,
  fetchRestPRFiles,
  getGitHubEndpoints,
  isBinaryFilePath,
  isImageFilePath,
  normalizeGitHubHost,
  parsePRUrl,
  setFileViewedState,
  setGitHubHost,
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

describe('github host & URL parsing', () => {
  afterEach(() => {
    setGitHubHost('github.com')
  })

  it('normalizes host strings and falls back to github.com', () => {
    expect(normalizeGitHubHost('')).toBe('github.com')
    expect(normalizeGitHubHost('   ')).toBe('github.com')
    expect(normalizeGitHubHost('https://GitHub.com/')).toBe('github.com')
    expect(normalizeGitHubHost('https://GHE.Company.com/api/v3')).toBe('ghe.company.com')
    expect(normalizeGitHubHost('ghe.internal:8443/')).toBe('ghe.internal:8443')
  })

  it('derives GraphQL and REST endpoints for github.com and custom GHE hosts', () => {
    expect(getGitHubEndpoints('github.com')).toEqual({
      graphqlUrl: 'https://api.github.com/graphql',
      restUrl: 'https://api.github.com',
    })

    expect(getGitHubEndpoints('ghe.company.com')).toEqual({
      graphqlUrl: 'https://ghe.company.com/api/graphql',
      restUrl: 'https://ghe.company.com/api/v3',
    })
  })

  it('parses github.com and custom GitHub Enterprise PR URLs', () => {
    expect(parsePRUrl('https://github.com/acme/stroll/pull/42')).toEqual({
      owner: 'acme',
      repo: 'stroll',
      number: 42,
    })

    expect(parsePRUrl('https://github.com/acme/stroll/pull/42/files')).toEqual({
      owner: 'acme',
      repo: 'stroll',
      number: 42,
    })

    // Custom host via explicit parameter
    expect(
      parsePRUrl('https://ghe.company.com/platform/core-api/pull/99/commits', 'ghe.company.com'),
    ).toEqual({
      owner: 'platform',
      repo: 'core-api',
      number: 99,
    })

    // Custom host via configured store/module host
    setGitHubHost('git.corp.example')
    expect(parsePRUrl('https://git.corp.example/team/service/pull/7')).toEqual({
      owner: 'team',
      repo: 'service',
      number: 7,
    })
    // github.com remains accepted even when custom host is configured
    expect(parsePRUrl('https://github.com/acme/stroll/pull/12')).toEqual({
      owner: 'acme',
      repo: 'stroll',
      number: 12,
    })

    // Rejects unrelated hosts or non-PR URLs
    expect(parsePRUrl('https://gitlab.com/acme/stroll/pull/42')).toBeNull()
    expect(parsePRUrl('https://github.com/acme/stroll/issues/42')).toBeNull()
    expect(parsePRUrl('not-a-url')).toBeNull()
  })

  it('calls markFileAsViewed and unmarkFileAsViewed GraphQL mutations', async () => {
    const fetchSpy = vi
      .spyOn(httpModule, 'httpFetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { markFileAsViewed: { pullRequest: { id: 'pr_1' } } } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { unmarkFileAsViewed: { pullRequest: { id: 'pr_1' } } } }),
          { status: 200 },
        ),
      )

    expect(await setFileViewedState('fake-pat', 'pr_1', 'src/app.ts', true)).toBe('VIEWED')
    expect(await setFileViewedState('fake-pat', 'pr_1', 'src/app.ts', false)).toBe('UNVIEWED')

    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(firstBody.query).toContain('markFileAsViewed')
    expect(firstBody.variables).toEqual({ pullRequestId: 'pr_1', path: 'src/app.ts' })

    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))
    expect(secondBody.query).toContain('unmarkFileAsViewed')
    expect(secondBody.variables).toEqual({ pullRequestId: 'pr_1', path: 'src/app.ts' })
  })

  it('collapses whitespace-only changes when ignoreWhitespace is enabled', () => {
    const file: PRFile = {
      path: 'src/ws.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      language: 'typescript',
      baseContent: 'const x=1\nconst y = 2\n',
      headContent: 'const x = 1\nconst y = 2\n',
      patch: '@@ -1,2 +1,2 @@\n-const x=1\n+const x = 1\n const y = 2',
    }
    const defaultSegs = buildDiffSegments(file)
    expect(defaultSegs[0]?.kind).toBe('hunk')
    if (defaultSegs[0]?.kind === 'hunk') {
      expect(defaultSegs[0].lines.some((l) => l.type === 'del')).toBe(true)
      expect(defaultSegs[0].lines.some((l) => l.type === 'add')).toBe(true)
    }

    const wsSegs = buildDiffSegments(file, { ignoreWhitespace: true })
    expect(wsSegs[0]?.kind).toBe('hunk')
    if (wsSegs[0]?.kind === 'hunk') {
      expect(wsSegs[0].lines.every((l) => l.type === 'context')).toBe(true)
    }
  })
})
