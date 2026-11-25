import * as LucideIcons from '@lucide/vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createPinia, setActivePinia } from 'pinia'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, defineComponent, nextTick, ssrContextKey } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import type { PRSummary } from '@/types/pr'
import PRInboxView from '../PRInboxView.vue'
import prInboxSource from '../PRInboxView.vue?raw'
import SelectDropdown from '../SelectDropdown.vue'
import selectDropdownSource from '../SelectDropdown.vue?raw'

function compileClientSFC(
  sfc: Vue.ComponentOptions,
  source: string,
  filename: string,
  extraBindings: Record<string, unknown> = {},
) {
  const { descriptor } = parse(source, { filename })
  const script = compileScript(descriptor, { id: filename })
  const tpl = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: filename,
    compilerOptions: {
      mode: 'function',
      hoistStatic: false,
      bindingMetadata: script.bindings,
      expressionPlugins: ['typescript'],
    },
  })
  const jsCode = ts.transpileModule(tpl.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const renderFn = new Function('Vue', jsCode)(Vue) as Vue.RenderFunction
  const ssrSetup = sfc.setup!
  return defineComponent({
    name: filename.replace('.vue', ''),
    props: sfc.props,
    emits: sfc.emits,
    setup(props: Record<string, unknown>, ctx: Vue.SetupContext) {
      const bindings = ssrSetup(props, ctx) as Record<string, unknown>
      return {
        ...LucideIcons,
        ...bindings,
        ...extraBindings,
      }
    },
    render: renderFn,
  })
}

const ClientSelectDropdown = compileClientSFC(
  SelectDropdown as Vue.ComponentOptions,
  selectDropdownSource,
  'SelectDropdown.vue',
)

function buildClientPRInboxView() {
  return compileClientSFC(
    PRInboxView as Vue.ComponentOptions,
    prInboxSource,
    'PRInboxView.vue',
    { SelectDropdown: ClientSelectDropdown },
  )
}

interface MockNode {
  type: string
  props: Record<string, unknown>
  text?: string
  value?: string
  parent?: MockNode | null
  children: MockNode[]
  classList?: { add: () => void; remove: () => void }
  addEventListener?: () => void
  removeEventListener?: () => void
}

const { createApp } = createRenderer<MockNode, MockNode>({
  patchProp(el, key, _prevValue, nextValue) {
    if (nextValue === undefined || nextValue === null) {
      delete el.props[key]
    } else {
      el.props[key] = nextValue
    }
  },
  insert(el, parent, anchor) {
    if (el.parent && el.parent !== parent) {
      const prevIdx = el.parent.children.indexOf(el)
      if (prevIdx >= 0) el.parent.children.splice(prevIdx, 1)
    } else if (el.parent === parent) {
      const prevIdx = parent.children.indexOf(el)
      if (prevIdx >= 0) parent.children.splice(prevIdx, 1)
    }
    el.parent = parent
    if (anchor) {
      const idx = parent.children.indexOf(anchor)
      if (idx >= 0) {
        parent.children.splice(idx, 0, el)
        return
      }
    }
    parent.children.push(el)
  },
  remove(el) {
    if (el.parent) {
      const idx = el.parent.children.indexOf(el)
      if (idx >= 0) el.parent.children.splice(idx, 1)
      el.parent = null
    }
  },
  createElement(type) {
    return {
      type,
      props: {},
      value: '',
      parent: null,
      children: [],
      classList: { add: () => {}, remove: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  },
  createText(text) {
    return { type: '#text', props: {}, text, parent: null, children: [] }
  },
  createComment(text) {
    return { type: '#comment', props: {}, text, parent: null, children: [] }
  },
  setText(node, text) {
    node.text = text
  },
  setElementText(node, text) {
    node.children = text ? [{ type: '#text', props: {}, text, parent: node, children: [] }] : []
  },
  parentNode: (node) => node.parent ?? null,
  nextSibling: (node) => {
    const siblings = node.parent?.children
    if (!siblings) return null
    const idx = siblings.indexOf(node)
    return idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1] : null
  },
})

function collectText(node: MockNode): string {
  if (node.type === '#text') return node.text ?? ''
  return node.children.map(collectText).join('')
}

function findNodes(root: MockNode, predicate: (node: MockNode) => boolean): MockNode[] {
  const out: MockNode[] = []
  if (predicate(root)) out.push(root)
  for (const child of root.children) {
    out.push(...findNodes(child, predicate))
  }
  return out
}

function createMemoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
  }
}

function makeSummary(overrides: Partial<PRSummary> = {}): PRSummary {
  return {
    id: 'pr-1',
    owner: 'acme',
    repo: 'stroll',
    number: 42,
    title: 'Fix inbox sort control',
    url: 'https://github.com/acme/stroll/pull/42',
    author: { login: 'octocat', avatarUrl: '' },
    updatedAt: '2026-11-24T12:00:00Z',
    additions: 10,
    deletions: 4,
    changedFiles: 2,
    isDraft: false,
    reviewDecision: null,
    ciState: 'SUCCESS',
    totalCommentsCount: 0,
    baseRefName: 'main',
    headRefName: 'fix/sort',
    isCrossRepository: false,
    ...overrides,
  }
}

const ClientPRInboxView = buildClientPRInboxView()

describe('PRInboxView toolbar filter and sort dropdowns', () => {
  const listeners = new Map<string, Set<{ fn: (e: unknown) => void; capture: boolean }>>()
  let unmountApp: (() => void) | null = null

  beforeEach(() => {
    listeners.clear()
    vi.stubGlobal('HTMLElement', class MockHTMLElement {})
    vi.stubGlobal('localStorage', createMemoryStorage())
    vi.stubGlobal('window', {
      addEventListener: (event: string, fn: (e: unknown) => void, capture = false) => {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add({ fn, capture: Boolean(capture) })
      },
      removeEventListener: (event: string, fn: (e: unknown) => void, capture = false) => {
        const set = listeners.get(event)
        if (!set) return
        for (const entry of set) {
          if (entry.fn === fn && entry.capture === Boolean(capture)) {
            set.delete(entry)
          }
        }
      },
      setInterval: () => 1,
      clearInterval: () => {},
    })
  })

  afterEach(() => {
    unmountApp?.()
    unmountApp = null
    vi.unstubAllGlobals()
  })

  function mountInbox() {
    const pinia = createPinia()
    setActivePinia(pinia)

    const auth = useAuthStore()
    auth.pat = 'ghp_test_token'
    auth.viewer = { login: 'octocat', avatarUrl: '' }
    auth.requestedPRs = [
      makeSummary({
        id: 'pr-1',
        repo: 'stroll',
        number: 42,
        title: 'Small PR',
        updatedAt: '2026-11-24T12:00:00Z',
        additions: 10,
        deletions: 2,
      }),
      makeSummary({
        id: 'pr-2',
        repo: 'other-repo',
        number: 17,
        title: 'Large PR',
        updatedAt: '2026-11-23T09:00:00Z',
        additions: 100,
        deletions: 25,
      }),
    ]

    const review = useReviewStore()
    review.screen = 'inbox'

    const root: MockNode = { type: 'root', props: {}, children: [] }
    const app = createApp(ClientPRInboxView)
    app.use(pinia)
    app.provide(ssrContextKey, {})
    app.mount(root)
    unmountApp = () => app.unmount()

    return { root }
  }

  it('renders non-overlapping button dropdowns instead of native select elements and supports sorting, filtering, and Escape', async () => {
    const { root } = mountInbox()
    await nextTick()

    expect(findNodes(root, (n) => n.type === 'select')).toHaveLength(0)

    const sortBtn = findNodes(
      root,
      (n) => n.type === 'button' && n.props['aria-label'] === 'Sort pull requests',
    )[0]
    expect(sortBtn).toBeDefined()
    expect(sortBtn.props['aria-haspopup']).toBe('listbox')
    expect(sortBtn.props['aria-expanded']).toBe(false)
    expect(collectText(sortBtn)).toContain('Recently Updated')

    ;(sortBtn.props.onClick as () => void)()
    await nextTick()

    expect(sortBtn.props['aria-expanded']).toBe(true)
    const sortListbox = findNodes(
      root,
      (n) => n.props.role === 'listbox' && n.props['aria-label'] === 'Sort pull requests',
    )[0]
    expect(sortListbox).toBeDefined()

    const largestDiffOpt = findNodes(
      sortListbox,
      (n) => n.props.role === 'option' && collectText(n).includes('Largest Diff'),
    )[0]
    ;(largestDiffOpt.props.onClick as () => void)()
    await nextTick()

    expect(sortBtn.props['aria-expanded']).toBe(false)
    expect(collectText(sortBtn)).toContain('Largest Diff')

    const repoBtn = findNodes(
      root,
      (n) => n.type === 'button' && n.props['aria-label'] === 'Filter by repository',
    )[0]
    ;(repoBtn.props.onClick as () => void)()
    await nextTick()

    expect(repoBtn.props['aria-expanded']).toBe(true)

    let stopped = false
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn(() => {
      stopped = true
    })
    // Dispatch capture-phase listeners before bubble-phase listeners, matching DOM propagation.
    const entries = [...(listeners.get('keydown') ?? [])]
    const ordered = [
      ...entries.filter((e) => e.capture),
      ...entries.filter((e) => !e.capture),
    ]
    for (const entry of ordered) {
      if (stopped) break
      entry.fn({ key: 'Escape', preventDefault, stopPropagation })
    }
    await nextTick()

    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(repoBtn.props['aria-expanded']).toBe(false)
  })

  it('shows offline banner while keeping PRs visible and responds to offline/online events', async () => {
    const { root } = mountInbox()
    const auth = useAuthStore()
    await nextTick()

    for (const entry of listeners.get('offline') ?? []) {
      entry.fn({})
    }
    await nextTick()

    expect(auth.isOffline).toBe(true)
    const alert = findNodes(root, (n) => n.props.role === 'alert')[0]
    expect(alert).toBeDefined()
    expect(collectText(alert)).toContain('No internet connection')
    expect(collectText(alert)).toContain('Showing last loaded PRs')
    expect(collectText(root)).toContain('Small PR')
    expect(collectText(root)).toContain('Large PR')
  })

  it('shows offline recovery card instead of onboarding when PAT is saved but unverified', async () => {
    const { root } = mountInbox()
    const auth = useAuthStore()
    auth.viewer = null
    auth.requestedPRs = []
    auth.isOffline = true
    auth.error = 'No internet connection — unable to reach GitHub.'
    await nextTick()

    const text = collectText(root)
    expect(text).toContain('You are currently offline')
    expect(text).toContain('Retry Connection')
    expect(text).not.toContain('Connect GitHub to see PRs awaiting your review')
  })
})
