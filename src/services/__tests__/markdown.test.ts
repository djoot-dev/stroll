import { describe, expect, it } from 'vitest'
import {
  parseChecklistProgress,
  renderSafeMarkdown,
  toggleChecklistItem,
} from '../markdown'

describe('renderSafeMarkdown', () => {
  it('returns empty string for blank input', () => {
    expect(renderSafeMarkdown('')).toBe('')
    expect(renderSafeMarkdown('   \n\t  ')).toBe('')
  })

  it('escapes raw HTML to prevent XSS', () => {
    const html = renderSafeMarkdown('<script>alert("xss")</script> <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })

  it('blocks unsafe link and image protocols', () => {
    const html = renderSafeMarkdown('[click](javascript:alert(1)) ![pic](data:text/html,<script>)')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('<img ')
    expect(html).toContain('click (javascript:alert(1))')
    expect(html).toContain('pic (data:text/html,&lt;script&gt;)')
  })

  it('renders headings h1 through h6', () => {
    const html = renderSafeMarkdown('# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6')
    expect(html).toContain('<h1 ')
    expect(html).toContain('<h2 ')
    expect(html).toContain('<h3 ')
    expect(html).toContain('<h4 ')
    expect(html).toContain('<h5 ')
    expect(html).toContain('<h6 ')
  })

  it('renders inline formatting without mangling snake_case or inline code', () => {
    const html = renderSafeMarkdown(
      '**bold** __also__ *em* _under_ ***both*** ~~strike~~ `my_var *keep*` snake_case_name',
    )
    expect(html).toContain('<strong class="font-semibold text-ink">bold</strong>')
    expect(html).toContain('<strong class="font-semibold text-ink">also</strong>')
    expect(html).toContain('<em class="italic">em</em>')
    expect(html).toContain('<em class="italic">under</em>')
    expect(html).toContain('<strong class="font-semibold text-ink"><em class="italic">both</em></strong>')
    expect(html).toContain('<del class="text-ink-muted line-through">strike</del>')
    expect(html).toContain('>my_var *keep*</code>')
    expect(html).toContain('snake_case_name')
    expect(html).not.toContain('<em class="italic">case</em>')
  })

  it('renders double-backtick inline code containing single backticks', () => {
    const html = renderSafeMarkdown('Use `` `foo` `` here')
    expect(html).toContain('>`foo`</code>')
  })

  it('renders links (including parentheses in URL), bare URLs, and safe images', () => {
    const html = renderSafeMarkdown(
      'See [Wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and https://example.com/a and ![logo](https://example.com/logo.png)',
    )
    expect(html).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"')
    expect(html).toContain('data-external-url="https://en.wikipedia.org/wiki/Foo_(bar)"')
    expect(html).toContain('href="https://example.com/a"')
    expect(html).toContain('<img src="https://example.com/logo.png" alt="logo"')
  })

  it('renders fenced code blocks with backticks or tildes and escapes code content', () => {
    const html = renderSafeMarkdown('```ts\nconst x = "<tag>"\n```\n\n~~~\nplain\n~~~')
    expect(html).toContain('>ts</div>')
    expect(html).toContain('const x = &quot;&lt;tag&gt;&quot;')
    expect(html).toContain('<pre ')
    expect(html).toContain('plain')
  })

  it('renders GFM tables with column alignments', () => {
    const md = [
      '| Name | Count | Ratio |',
      '| :--- | :---: | ---: |',
      '| **alpha** | `10` | 50% |',
      '| beta | 20 | 100% |',
    ].join('\n')
    const html = renderSafeMarkdown(md)
    expect(html).toContain('<table ')
    expect(html).toContain('text-left">Name</th>')
    expect(html).toContain('text-center">Count</th>')
    expect(html).toContain('text-right">Ratio</th>')
    expect(html).toContain('<strong class="font-semibold text-ink">alpha</strong>')
    expect(html).toContain('>10</code>')
    expect(html).toContain('beta')
  })

  it('renders nested lists and GitHub task checkboxes', () => {
    const md = [
      '- [x] Done item',
      '- [ ] Pending item',
      '  - Nested bullet',
      '  1. Nested ordered',
    ].join('\n')
    const html = renderSafeMarkdown(md)
    expect(html).toContain('aria-label="Checked"')
    expect(html).toContain('aria-label="Unchecked"')
    expect(html).toContain('Nested bullet')
    expect(html).toContain('<ol ')
    expect(html).toContain('Nested ordered')
  })

  it('renders blockquotes and GitHub alert callouts', () => {
    const html = renderSafeMarkdown('> Simple quote\n\n> [!WARNING]\n> Watch out for **edge cases**')
    expect(html).toContain('<blockquote ')
    expect(html).toContain('Simple quote')
    expect(html).toContain('Warning</div>')
    expect(html).toContain('Watch out for <strong class="font-semibold text-ink">edge cases</strong>')
  })

  it('renders GitHub suggestion blocks with optional original lines', () => {
    const md = ['Consider:', '```suggestion', 'const total = count * 2', '```'].join('\n')
    const html = renderSafeMarkdown(md, { originalLines: ['const total = count'] })
    expect(html).toContain('Suggested change')
    expect(html).toContain('const total = count')
    expect(html).toContain('const total = count * 2')
  })

  it('strips GitHub HTML comments outside code blocks while preserving comments inside code', () => {
    const md = [
      '## Summary',
      '<!-- PR template hint',
      'multi-line comment -->',
      'Visible text <!-- inline hidden --> continues.',
      '',
      'Inline `<!-- kept in backticks -->` stays visible.',
      '',
      '```html',
      '<!-- kept in fenced block -->',
      '```',
    ].join('\n')

    const html = renderSafeMarkdown(md)
    expect(html).toContain('Summary')
    expect(html).toContain('Visible text  continues.')
    expect(html).not.toContain('PR template hint')
    expect(html).not.toContain('inline hidden')
    expect(html).toContain('&lt;!-- kept in backticks --&gt;')
    expect(html).toContain('&lt;!-- kept in fenced block --&gt;')
  })

  it('strips HTML comments that contain backticks or fenced code blocks', () => {
    const md = [
      '<!-- PR template: run `bun run test` and check `Fixes #123` -->',
      '<!--',
      '```ts',
      'const example = true',
      '```',
      '-->',
      'Actual PR description.',
    ].join('\n')

    const html = renderSafeMarkdown(md)
    expect(html).toContain('Actual PR description.')
    expect(html).not.toContain('PR template')
    expect(html).not.toContain('bun run test')
    expect(html).not.toContain('const example')
  })

  it('returns empty string when markdown only contains HTML comments', () => {
    expect(renderSafeMarkdown('<!-- Describe your changes -->\n\n<!-- Checklist -->')).toBe('')
  })
})

describe('checklist helpers', () => {
  it('counts task items while ignoring fenced code blocks and HTML comments', () => {
    const md = [
      '<!--',
      '- [ ] Ignored in comment',
      '-->',
      '```md',
      '- [x] Ignored in code block',
      '```',
      '- [x] First done',
      '- [X] Second uppercase done',
      '  - [ ] Nested pending',
      '* [ ] Asterisk pending',
      '1. [ ] Ordered list is not a task list',
    ].join('\n')

    expect(parseChecklistProgress(md)).toEqual({ total: 4, completed: 2 })
  })

  it('toggles a specific checklist item by index while preserving formatting and comments', () => {
    const md = [
      '<!-- keep me -->',
      '- [x] First',
      '- [ ] Second',
      '  - [X] Third',
    ].join('\r\n')

    const afterCheck = toggleChecklistItem(md, 1)
    expect(afterCheck).toBe(
      ['<!-- keep me -->', '- [x] First', '- [x] Second', '  - [X] Third'].join('\r\n'),
    )

    const afterUncheck = toggleChecklistItem(afterCheck, 2)
    expect(afterUncheck).toBe(
      ['<!-- keep me -->', '- [x] First', '- [x] Second', '  - [ ] Third'].join('\r\n'),
    )

    expect(toggleChecklistItem(md, 99)).toBe(md)
  })

  it('renders interactive task buttons with data-task-index when interactiveChecklist is true', () => {
    const html = renderSafeMarkdown('- [x] Done\n- [ ] Todo', { interactiveChecklist: true })
    expect(html).toContain('<button type="button" data-task-index="0" aria-label="Checked"')
    expect(html).toContain('<button type="button" data-task-index="1" aria-label="Unchecked"')
  })
})
