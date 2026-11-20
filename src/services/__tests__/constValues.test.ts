import { describe, expect, it } from 'vitest'
import {
  extractConstDeclarations,
  extractConstValueFromSnippet,
  formatConstValue,
  isFunctionLikeValue,
} from '../constValues'

function byName(content: string, language: string, path = '') {
  return new Map(extractConstDeclarations(content, language, path).map((d) => [d.name, d]))
}

describe('extractConstDeclarations — TypeScript / JavaScript', () => {
  it('extracts exported consts with values and skips function values', () => {
    const src = [
      'export const TIMEOUT_MS = 30_000',
      "export const API_URL: string = 'https://api.github.com'",
      'export const LIMITS = {',
      '  files: 300, // comment is stripped',
      '  lines: 20_000,',
      '} as const',
      'export const handler = async (req) => {',
      '  return 1',
      '}',
      'export const delay = 60 * 1000;',
    ].join('\n')
    const decls = byName(src, 'typescript')

    expect(decls.get('TIMEOUT_MS')).toMatchObject({ value: '30_000', fileLocal: false, startIdx: 0, endIdx: 0 })
    expect(decls.get('API_URL')?.value).toBe("'https://api.github.com'")
    expect(decls.get('LIMITS')).toMatchObject({
      value: '{ files: 300, lines: 20_000 } as const',
      startIdx: 2,
      endIdx: 5,
    })
    expect(decls.get('handler')?.value).toBeNull()
    expect(decls.get('delay')?.value).toBe('60 * 1000')
  })

  it('indexes top-level non-exported constants as file-local, ignoring ordinary locals', () => {
    const src = [
      'const POPOVER_WIDTH = 460',
      "const label = 'hello'",
      'const store = useStore()',
      'function f() {',
      '  const INNER = 1',
      '}',
    ].join('\n')
    const decls = byName(src, 'typescript')
    expect(decls.get('POPOVER_WIDTH')).toMatchObject({ value: '460', fileLocal: true })
    expect(decls.get('label')).toMatchObject({ value: "'hello'", fileLocal: true })
    expect(decls.has('store')).toBe(false)
    expect(decls.has('INNER')).toBe(false)
  })

  it('stops a semicolon-less value at the end of the statement, even before a comment line', () => {
    const src = ['export const A = 1', '// note', 'export const B = 2'].join('\n')
    const decls = byName(src, 'typescript')
    expect(decls.get('A')).toMatchObject({ value: '1', endIdx: 0 })
    expect(decls.get('B')?.value).toBe('2')
  })

  it('does not swallow the closing </script> tag in Vue files', () => {
    const src = [
      '<script setup lang="ts">',
      'const MAX_ITEMS = 5',
      '</script>',
      '<template><div /></template>',
    ].join('\n')
    const decls = byName(src, 'vue', 'Comp.vue')
    expect(decls.get('MAX_ITEMS')).toMatchObject({ value: '5', endIdx: 1 })
  })

  it('extracts enum members with explicit and implicit values', () => {
    const src = [
      'export enum Status {',
      '  Active = 2,',
      '  Inactive,',
      "  Archived = 'archived',",
      '}',
      'export const enum Dir { Up, Down }',
    ].join('\n')
    const decls = byName(src, 'typescript')
    expect(decls.get('Status.Active')).toMatchObject({ kind: 'enumMember', value: '2', valueNote: null, startIdx: 1 })
    expect(decls.get('Status.Inactive')).toMatchObject({ value: '3', valueNote: 'implicit' })
    expect(decls.get('Status.Archived')?.value).toBe("'archived'")
    expect(decls.get('Dir.Up')).toMatchObject({ value: '0', valueNote: 'implicit' })
    expect(decls.get('Dir.Down')?.value).toBe('1')
  })
})

describe('extractConstDeclarations — C#', () => {
  it('captures the field name (not the type) and visibility', () => {
    const src = [
      'public static class Limits',
      '{',
      '    public const int MaxRetries = 5;',
      '    private const string Prefix = "stroll:";',
      '    internal static readonly TimeSpan Backoff = TimeSpan.FromSeconds(2);',
      '    public static readonly Dictionary<string, int> Weights = new()',
      '    {',
      '        ["a"] = 1,',
      '    };',
      '    public static int Mutable = 3;',
      '    public int Compute(int a = 5) => a;',
      '}',
    ].join('\n')
    const decls = byName(src, 'csharp')

    expect(decls.has('int')).toBe(false)
    expect(decls.get('MaxRetries')).toMatchObject({ value: '5', valueNote: null, fileLocal: false })
    expect(decls.get('Prefix')).toMatchObject({ value: '"stroll:"', fileLocal: true })
    expect(decls.get('Backoff')).toMatchObject({
      value: 'TimeSpan.FromSeconds(2)',
      valueNote: 'readonly',
      fileLocal: false,
    })
    expect(decls.get('Weights')).toMatchObject({ value: 'new() { ["a"] = 1 }', startIdx: 5, endIdx: 8 })
    expect(decls.has('Mutable')).toBe(false)
    expect(decls.has('a')).toBe(false)
  })

  it('extracts enum members, skipping attributes and handling flags', () => {
    const src = [
      'public enum OrderStatus : byte',
      '{',
      '    [Description("Waiting")]',
      '    Pending,',
      '    Completed = 4,',
      '    Shipped,',
      '    Mask = Pending | Completed,',
      '    Other',
      '}',
    ].join('\n')
    const decls = byName(src, 'csharp')
    expect(decls.get('OrderStatus.Pending')).toMatchObject({ value: '0', valueNote: 'implicit', startIdx: 3 })
    expect(decls.get('OrderStatus.Completed')?.value).toBe('4')
    expect(decls.get('OrderStatus.Shipped')).toMatchObject({ value: '5', valueNote: 'implicit' })
    expect(decls.get('OrderStatus.Mask')?.value).toBe('Pending | Completed')
    // Can't infer after a non-literal initializer.
    expect(decls.get('OrderStatus.Other')?.value).toBeNull()
  })
})

describe('extractConstDeclarations — Rust', () => {
  it('extracts const/static (not static mut) and enum discriminants', () => {
    const src = [
      'pub const MAX_FILES: usize = 50_000;',
      'const SKIP_DIRS: &[&str] = &["bin", "obj"];',
      "static GREETING: &'static str = \"hi\";",
      'static mut COUNTER: u32 = 0;',
      'pub const fn helper() -> u32 { 1 }',
      'pub enum Mode {',
      '    Fast = 1,',
      '    Slow,',
      '}',
      'enum Shape {',
      '    Circle(f32),',
      '    Empty,',
      '}',
    ].join('\n')
    const decls = byName(src, 'rust')
    expect(decls.get('MAX_FILES')).toMatchObject({ value: '50_000', fileLocal: false })
    expect(decls.get('SKIP_DIRS')).toMatchObject({ value: '&["bin", "obj"]', fileLocal: true })
    expect(decls.get('GREETING')?.value).toBe('"hi"')
    expect(decls.has('COUNTER')).toBe(false)
    expect(decls.has('helper')).toBe(false)
    expect(decls.get('Mode::Fast')?.value).toBe('1')
    expect(decls.get('Mode::Slow')).toMatchObject({ value: '2', valueNote: 'implicit' })
    // Enums with data have no meaningful implicit discriminants.
    expect(decls.get('Shape::Empty')?.value).toBeNull()
  })
})

describe('extractConstDeclarations — Python', () => {
  it('treats module-level UPPER_CASE as constant by convention, unless Final', () => {
    const src = [
      'MAX_SIZE = 10',
      'TIMEOUT: Final[int] = 30  # seconds',
      'DEFAULTS = {',
      '    "a": 1,',
      '}',
      'lower = 5',
      'def f():',
      '    INNER = 1',
      'HANDLER = lambda x: x',
    ].join('\n')
    const decls = byName(src, 'python')
    expect(decls.get('MAX_SIZE')).toMatchObject({ value: '10', valueNote: 'convention' })
    expect(decls.get('TIMEOUT')).toMatchObject({ value: '30', valueNote: null })
    expect(decls.get('DEFAULTS')).toMatchObject({ value: '{ "a": 1 }', endIdx: 4 })
    expect(decls.has('lower')).toBe(false)
    expect(decls.has('INNER')).toBe(false)
    expect(decls.get('HANDLER')?.value).toBeNull()
  })

  it('extracts Enum class members', () => {
    const src = [
      'class Color(str, Enum):',
      '    RED = "red"',
      '    GREEN = auto()',
      '',
      '    def describe(self):',
      '        LOCAL = 1',
      'class Plain:',
      '    X = 1',
    ].join('\n')
    const decls = byName(src, 'python')
    expect(decls.get('Color.RED')).toMatchObject({ kind: 'enumMember', value: '"red"', startIdx: 1 })
    expect(decls.get('Color.GREEN')?.value).toBe('auto()')
    expect(decls.has('Color.LOCAL')).toBe(false)
    expect(decls.has('Plain.X')).toBe(false)
  })
})

describe('value helpers', () => {
  it('formats and truncates values', () => {
    expect(formatConstValue('  [\n  1,\n  2\n];')).toBe('[1, 2]')
    const long = formatConstValue(`'${'x'.repeat(200)}'`)!
    expect(long.length).toBe(80)
    expect(long.endsWith('…')).toBe(true)
  })

  it('detects function-like values', () => {
    expect(isFunctionLikeValue('() => 1')).toBe(true)
    expect(isFunctionLikeValue('async (a: number): Promise<void> => {}')).toBe(true)
    expect(isFunctionLikeValue('x => x')).toBe(true)
    expect(isFunctionLikeValue('function () {}')).toBe(true)
    expect(isFunctionLikeValue('compute(1)')).toBe(false)
    expect(isFunctionLikeValue('(1 + 2) * 3')).toBe(false)
  })

  it('extracts values from native resolver snippets', () => {
    expect(extractConstValueFromSnippet('    public const int MaxRetries = 5;', 'Limits.MaxRetries', 'csharp')).toEqual({
      value: '5',
      valueNote: null,
    })
    expect(extractConstValueFromSnippet('    Completed = 4,', 'OrderStatus.Completed', 'csharp')?.value).toBe('4')
    expect(extractConstValueFromSnippet('    GREEN = 2', 'Color.GREEN', 'python')?.value).toBe('2')
    expect(extractConstValueFromSnippet('MAX = 3', 'MAX', 'python')).toEqual({ value: '3', valueNote: 'convention' })
    expect(extractConstValueFromSnippet('    Slow,', 'Mode::Slow', 'rust')).toBeNull()
  })
})
