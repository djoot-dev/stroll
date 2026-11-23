import { computed, nextTick, onBeforeUnmount, ref, type Ref } from 'vue'
import {
  fetchMentionableUsers,
  searchRepoPRReferences,
  type PRReferenceMeta,
} from '@/services/github'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import type { GitHubUser } from '@/types/pr'

export type AutocompleteTrigger = '@' | '#'

export interface AutocompleteOption {
  id: string
  trigger: AutocompleteTrigger
  insertText: string
  primary: string
  secondary?: string | null
  avatarUrl?: string
  refState?: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft?: boolean
  refKind?: 'pull' | 'issue'
}

function getCaretCoordinates(textarea: HTMLTextAreaElement, position: number): { top: number; left: number } {
  const rect = textarea.getBoundingClientRect()
  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const props = [
    'boxSizing',
    'width',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'textTransform',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
  ] as const

  mirror.style.position = 'fixed'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.overflowWrap = 'break-word'
  for (const prop of props) {
    mirror.style[prop] = style[prop]
  }
  mirror.textContent = textarea.value.slice(0, position)
  const span = document.createElement('span')
  span.textContent = textarea.value.slice(position) || '.'
  mirror.appendChild(span)
  document.body.appendChild(mirror)

  const spanTop = span.offsetTop - textarea.scrollTop
  const spanLeft = span.offsetLeft - textarea.scrollLeft
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 18
  document.body.removeChild(mirror)

  return {
    top: rect.top + spanTop + lineHeight + 4,
    left: rect.left + spanLeft,
  }
}

export function useCommentAutocomplete(
  textareaRef: Ref<HTMLTextAreaElement | null>,
  getValue: () => string,
  setValue: (next: string) => void,
) {
  const auth = useAuthStore()
  const review = useReviewStore()

  const isOpen = ref(false)
  const trigger = ref<AutocompleteTrigger>('@')
  const query = ref('')
  const triggerStart = ref(0)
  const caretEnd = ref(0)
  const activeIndex = ref(0)
  const isLoading = ref(false)
  const remoteUsers = ref<GitHubUser[]>([])
  const remoteRefs = ref<PRReferenceMeta[]>([])
  const coords = ref({ top: 0, left: 0 })

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let seq = 0

  const prParticipants = computed<GitHubUser[]>(() => {
    const pr = review.pr
    if (!pr) return []
    const byLogin = new Map<string, GitHubUser>()
    const add = (u?: { login?: string; name?: string | null; avatarUrl?: string | null } | null) => {
      if (!u?.login) return
      const key = u.login.toLowerCase()
      if (!byLogin.has(key)) {
        byLogin.set(key, {
          login: u.login,
          name: u.name ?? null,
          avatarUrl: u.avatarUrl ?? '',
        })
      }
    }
    add(pr.author)
    for (const r of pr.requestedReviewers) {
      if (r.type === 'user') add(r)
    }
    for (const r of pr.reviews) add(r.author)
    for (const c of pr.issueComments) add(c.author)
    for (const t of pr.threads) {
      for (const c of t.comments) add(c.author)
    }
    return Array.from(byLogin.values())
  })

  const localPRRefs = computed<PRReferenceMeta[]>(() => {
    const pr = review.pr
    if (!pr) return []
    const items: PRReferenceMeta[] = []
    const seen = new Set<number>()
    for (const s of auth.requestedPRs) {
      if (
        s.owner.toLowerCase() === pr.owner.toLowerCase() &&
        s.repo.toLowerCase() === pr.repo.toLowerCase() &&
        !seen.has(s.number)
      ) {
        seen.add(s.number)
        items.push({
          owner: s.owner,
          repo: s.repo,
          number: s.number,
          title: s.title,
          state: 'OPEN',
          isDraft: s.isDraft,
          kind: 'pull',
          url: s.url,
        })
      }
    }
    if (!seen.has(pr.number)) {
      items.unshift({
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        isDraft: pr.isDraft,
        kind: 'pull',
        url: pr.url,
      })
    }
    return items
  })

  const options = computed<AutocompleteOption[]>(() => {
    const q = query.value.trim().toLowerCase()
    if (trigger.value === '@') {
      const merged = new Map<string, GitHubUser>()
      for (const u of prParticipants.value) merged.set(u.login.toLowerCase(), u)
      for (const u of remoteUsers.value) {
        if (!merged.has(u.login.toLowerCase())) merged.set(u.login.toLowerCase(), u)
      }
      return Array.from(merged.values())
        .filter(
          (u) =>
            !q ||
            u.login.toLowerCase().includes(q) ||
            (u.name?.toLowerCase().includes(q) ?? false),
        )
        .slice(0, 10)
        .map((u) => ({
          id: `user:${u.login}`,
          trigger: '@',
          insertText: `@${u.login} `,
          primary: `@${u.login}`,
          secondary: u.name,
          avatarUrl: u.avatarUrl,
        }))
    }

    const mergedRefs = new Map<number, PRReferenceMeta>()
    for (const r of localPRRefs.value) mergedRefs.set(r.number, r)
    for (const r of remoteRefs.value) {
      if (!mergedRefs.has(r.number)) mergedRefs.set(r.number, r)
    }
    return Array.from(mergedRefs.values())
      .filter((r) => {
        if (!q) return true
        return String(r.number).includes(q) || r.title.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'pull' ? -1 : 1
        return b.number - a.number
      })
      .slice(0, 12)
      .map((r) => ({
        id: `ref:${r.number}`,
        trigger: '#',
        insertText: `#${r.number} `,
        primary: `#${r.number}`,
        secondary: r.title,
        refState: r.state,
        isDraft: r.isDraft,
        refKind: r.kind,
      }))
  })

  function close() {
    isOpen.value = false
    if (debounceTimer) clearTimeout(debounceTimer)
  }

  function scheduleRemoteLookup(trig: AutocompleteTrigger, q: string) {
    const pr = review.pr
    if (!pr || pr.isMock || !auth.pat) return
    if (debounceTimer) clearTimeout(debounceTimer)
    const mySeq = ++seq
    isLoading.value = true
    debounceTimer = setTimeout(async () => {
      try {
        if (trig === '@') {
          const users = await fetchMentionableUsers(auth.pat!, pr.owner, pr.repo, q)
          if (mySeq === seq) remoteUsers.value = users
        } else {
          const refs = await searchRepoPRReferences(auth.pat!, pr.owner, pr.repo, q)
          if (mySeq === seq) remoteRefs.value = refs
        }
      } catch {
        // Best-effort lookup
      } finally {
        if (mySeq === seq) isLoading.value = false
      }
    }, 200)
  }

  function onInputOrCursor() {
    const el = textareaRef.value
    if (!el) return
    const pos = el.selectionStart ?? 0
    const before = el.value.slice(0, pos)
    const match = before.match(/(?:^|[\s(])([@#])([^\s@#]*)$/)
    if (!match) {
      close()
      return
    }
    const trig = match[1] as AutocompleteTrigger
    const q = match[2]
    const start = pos - q.length - 1

    const changedTrigger = !isOpen.value || trigger.value !== trig || query.value !== q
    trigger.value = trig
    query.value = q
    triggerStart.value = start
    caretEnd.value = pos
    isOpen.value = true
    coords.value = getCaretCoordinates(el, pos)

    if (changedTrigger) {
      activeIndex.value = 0
      scheduleRemoteLookup(trig, q)
    }
  }

  function selectOption(opt: AutocompleteOption) {
    const el = textareaRef.value
    const val = getValue()
    const before = val.slice(0, triggerStart.value)
    const after = val.slice(caretEnd.value)
    const next = `${before}${opt.insertText}${after}`
    setValue(next)
    close()
    const nextCaret = before.length + opt.insertText.length
    void nextTick(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function handleKeydown(e: KeyboardEvent): boolean {
    if (!isOpen.value) return false
    const len = options.value.length
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return true
    }
    if (e.key === 'ArrowDown') {
      if (len > 0) {
        e.preventDefault()
        activeIndex.value = (activeIndex.value + 1) % len
        return true
      }
    }
    if (e.key === 'ArrowUp') {
      if (len > 0) {
        e.preventDefault()
        activeIndex.value = (activeIndex.value - 1 + len) % len
        return true
      }
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const active = options.value[activeIndex.value]
      if (active) {
        e.preventDefault()
        selectOption(active)
        return true
      }
    }
    return false
  }

  onBeforeUnmount(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  return {
    isOpen,
    trigger,
    options,
    activeIndex,
    isLoading,
    coords,
    onInputOrCursor,
    handleKeydown,
    selectOption,
    close,
  }
}
