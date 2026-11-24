import * as LucideIcons from '@lucide/vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createPinia, setActivePinia } from 'pinia'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, defineComponent, nextTick, ssrContextKey } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import type { PullRequestData } from '@/types/pr'
import TourSidebar from '../TourSidebar.vue'
import tourSidebarSource from '../TourSidebar.vue?raw'
import SelectDropdown from '../SelectDropdown.vue'
import selectDropdownSource from '../SelectDropdown.vue?raw'

const openExternalUrlMock = vi.fn<(url: string) => Promise<void>>(async () => undefined)
const fetchPullRequestMock = vi.fn<
  (
    pat: string,
    owner: string,
    repo: string,
    number: number,
    localRepoPath?: string | null,
  ) => Promise<PullRequestData>
>()

vi.mock('@/services/native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/native')>()
  return {
    ...actual,
    openExternalUrl: (url: string) => openExternalUrlMock(url),
  }
})

vi.mock('@/services/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/github')>()
  return {
    ...actual,
    fetchPullRequest: (
      pat: string,
      owner: string,
      repo: string,
      number: number,
      localRepoPath?: string | null,
    ) => fetchPullRequestMock(pat, owner, repo, number, localRepoPath),
    fetchOpenRepoPRsForStack: vi.fn(async () => ({ defaultBranch: 'main', prs: [] })),
  }
})

/**
 * Compile TourSidebar.vue's <template> in client (non-SSR) mode so we can mount
 * the real compiled template + setup() with Vue's custom renderer in Node.
 */
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

function buildClientTourSidebar() {
  return compileClientSFC(
    TourSidebar as Vue.ComponentOptions,
    tourSidebarSource,
    'TourSidebar.vue',
    { SelectDropdown: ClientSelectDropdown },
  )
}

interface MockNode {
  type: string
  props: Record<string, unknown>
  text?: string
  parent?: MockNode | null
  children: MockNode[]
  classList?: { add: () => void; remove: () => void }
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
    if (el.parent) {
      const prevIdx = el.parent.children.indexOf(el)
      if (prevIdx >= 0) el.parent.children.splice(prevIdx, 1)
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
      parent: null,
      children: [],
      classList: { add: () => {}, remove: () => {} },
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

function makePR(overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    ...structuredClone(MOCK_PR),
    id: 'pr_42',
    number: 42,
    title: 'Middle PR',
    url: 'https://github.com/acme/stroll/pull/42',
    owner: 'acme',
    repo: 'stroll',
    baseRefName: 'feat/part-1',
    headRefName: 'feat/part-2',
    isMock: false,
    ...overrides,
  }
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

const ClientTourSidebar = buildClientTourSidebar()

describe('TourSidebar stack navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    openExternalUrlMock.mockReset()
    fetchPullRequestMock.mockReset()
  })

  it('clicks ↑ and ↓ stack buttons to call loadPRByRepo with prev/next nodes and shows busy/error state', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const auth = useAuthStore()
    auth.pat = 'ghp_test_token'

    const review = useReviewStore()
    review.pr = makePR()
    await nextTick()
    review.prStack = {
      rootBaseRef: 'main',
      baseIsNotDefault: true,
      currentPosition: 2,
      totalCount: 3,
      ancestors: [
        {
          owner: 'acme',
          repo: 'stroll',
          number: 40,
          title: 'Part 1',
          url: 'https://github.com/acme/stroll/pull/40',
          state: 'OPEN',
          isDraft: false,
          baseRefName: 'main',
          headRefName: 'feat/part-1',
          isCrossRepository: false,
          reviewDecision: null,
          ciState: 'SUCCESS',
          isCurrent: false,
          children: [],
        },
      ],
      current: {
        owner: 'acme',
        repo: 'stroll',
        number: 42,
        title: 'Middle PR',
        url: 'https://github.com/acme/stroll/pull/42',
        state: 'OPEN',
        isDraft: false,
        baseRefName: 'feat/part-1',
        headRefName: 'feat/part-2',
        isCrossRepository: false,
        reviewDecision: null,
        ciState: 'SUCCESS',
        isCurrent: true,
        children: [],
      },
      descendants: [
        {
          owner: 'acme',
          repo: 'stroll',
          number: 44,
          title: 'Part 3',
          url: 'https://github.com/acme/stroll/pull/44',
          state: 'OPEN',
          isDraft: false,
          baseRefName: 'feat/part-2',
          headRefName: 'feat/part-3',
          isCrossRepository: false,
          reviewDecision: null,
          ciState: 'PENDING',
          isCurrent: false,
          children: [],
        },
      ],
      flatChain: [],
    }

    fetchPullRequestMock.mockResolvedValue(makePR())

    const root: MockNode = { type: 'root', props: {}, children: [] }
    const app = createApp(ClientTourSidebar)
    app.provide(ssrContextKey, { modules: new Set() })
    app.use(pinia)
    app.mount(root)
    await nextTick()

    const prevBtn = findNodes(
      root,
      (n) => n.type === 'button' && collectText(n).includes('↑ #40'),
    )[0]
    const nextBtn = findNodes(
      root,
      (n) => n.type === 'button' && collectText(n).includes('↓ #44'),
    )[0]

    expect(prevBtn).toBeDefined()
    expect(nextBtn).toBeDefined()

    // Clicking ↓ calls loadPRByRepo (via openStackPR) with next node (#44)
    await (nextBtn.props.onClick as () => Promise<void>)()
    expect(fetchPullRequestMock).toHaveBeenCalledWith('ghp_test_token', 'acme', 'stroll', 44, null)

    // Clicking ↑ calls loadPRByRepo (via openStackPR) with prev node (#40)
    await (prevBtn.props.onClick as () => Promise<void>)()
    expect(fetchPullRequestMock).toHaveBeenCalledWith('ghp_test_token', 'acme', 'stroll', 40, null)

    // Busy/disabled state when loading #44
    review.isLoadingPR = true
    review.loadingPRKey = 'acme/stroll#44'
    await nextTick()

    expect(prevBtn.props.disabled).toBe(true)
    expect(nextBtn.props.disabled).toBe(true)
    expect(nextBtn.props['aria-busy']).toBe(true)
    expect(prevBtn.props['aria-busy']).toBe(false)

    // Inline error banner + dismiss
    review.isLoadingPR = false
    review.loadingPRKey = null
    review.prError = 'Failed to load #44'
    await nextTick()

    const alertNode = findNodes(root, (n) => n.props.role === 'alert')[0]
    expect(alertNode).toBeDefined()
    expect(collectText(alertNode)).toContain('Failed to load #44')

    const dismissBtn = findNodes(
      alertNode,
      (n) => n.type === 'button' && n.props['aria-label'] === 'Dismiss error',
    )[0]
    ;(dismissBtn.props.onClick as () => void)()
    await nextTick()
    expect(review.prError).toBeNull()

    app.unmount()
  })

  it('opens external URL in demo mode when clicking stack buttons', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const review = useReviewStore()
    await review.loadMockPR()
    expect(review.prStack).not.toBeNull()

    const loadSpy = vi.spyOn(review, 'loadPRByRepo')

    const root: MockNode = { type: 'root', props: {}, children: [] }
    const app = createApp(ClientTourSidebar)
    app.provide(ssrContextKey, { modules: new Set() })
    app.use(pinia)
    app.mount(root)
    await nextTick()

    const nextNode = review.prStack!.descendants[0]
    const nextBtn = findNodes(
      root,
      (n) => n.type === 'button' && collectText(n).includes(`↓ #${nextNode.number}`),
    )[0]
    expect(nextBtn).toBeDefined()

    await (nextBtn.props.onClick as () => Promise<void>)()
    expect(openExternalUrlMock).toHaveBeenCalledWith(nextNode.url)
    expect(loadSpy).not.toHaveBeenCalled()

    app.unmount()
  })

  it('renders SelectDropdown for commit filtering without native select and calls setCommitFilter on option click', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const review = useReviewStore()
    await review.loadMockPR()
    const setCommitFilterSpy = vi.spyOn(review, 'setCommitFilter').mockResolvedValue()

    const root: MockNode = { type: 'root', props: {}, children: [] }
    const app = createApp(ClientTourSidebar)
    app.provide(ssrContextKey, { modules: new Set() })
    app.use(pinia)
    app.mount(root)
    await nextTick()

    expect(findNodes(root, (n) => n.type === 'select')).toHaveLength(0)

    const commitBtn = findNodes(
      root,
      (n) => n.type === 'button' && n.props['aria-label'] === 'Filter tour by commit',
    )[0]
    expect(commitBtn).toBeDefined()
    expect(commitBtn.props['aria-haspopup']).toBe('listbox')
    expect(collectText(commitBtn)).toContain(`All commits (${review.pr!.commits.length})`)

    ;(commitBtn.props.onClick as () => void)()
    await nextTick()

    const listbox = findNodes(
      root,
      (n) => n.props.role === 'listbox' && n.props['aria-label'] === 'Filter tour by commit',
    )[0]
    expect(listbox).toBeDefined()

    const firstCommit = review.pr!.commits[0]
    const commitOption = findNodes(
      listbox,
      (n) => n.props.role === 'option' && collectText(n).includes(firstCommit.shortOid),
    )[0]
    expect(commitOption).toBeDefined()

    ;(commitOption.props.onClick as () => void)()
    await nextTick()

    expect(setCommitFilterSpy).toHaveBeenCalledWith(firstCommit.oid)
    app.unmount()
  })
})
