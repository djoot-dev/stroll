import { nextTick, onBeforeUnmount, watch, type Ref, type WatchSource } from 'vue'
import {
  fetchPRReferenceMetadataBatch,
  getCachedPRReferenceMeta,
  type PRReferenceMeta,
} from '@/services/github'
import { httpFetch } from '@/services/http'
import { copyToClipboard, openExternalUrl } from '@/services/native'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'

function applyRefChipMeta(anchor: HTMLAnchorElement, meta: PRReferenceMeta) {
  anchor.setAttribute('data-pr-kind', meta.kind)
  anchor.setAttribute('href', meta.url)
  anchor.setAttribute('data-external-url', meta.url)
  anchor.title = `${meta.kind === 'pull' ? 'PR' : 'Issue'} #${meta.number}: ${meta.title}`

  const dot = anchor.querySelector<HTMLElement>('[data-ref-dot]')
  if (dot) {
    dot.className = 'inline-block h-1.5 w-1.5 shrink-0 rounded-full'
    if (meta.state === 'MERGED') dot.classList.add('bg-plum')
    else if (meta.state === 'CLOSED') dot.classList.add('bg-crimson')
    else if (meta.isDraft) dot.classList.add('bg-ink-faint')
    else dot.classList.add('bg-pine')
  }

  const titleEl = anchor.querySelector<HTMLElement>('[data-ref-title]')
  if (titleEl) {
    titleEl.textContent = meta.title
    titleEl.classList.remove('hidden')
  }
}

export interface UseMarkdownDomOptions {
  interactiveChecklist?: () => boolean
  onToggleTask?: (index: number) => void
}

/**
 * Shared DOM behavior for rendered safe markdown containers:
 * - PR/issue reference chip metadata enrichment
 * - Authenticated private video attachment fallback
 * - Copy-code buttons (skipping deleted diff lines when present)
 * - External links and interactive task checkboxes
 */
export function useMarkdownDom(
  rootRef: Ref<HTMLElement | null>,
  refreshSource: WatchSource<unknown>,
  options?: UseMarkdownDomOptions,
) {
  const auth = useAuthStore()
  const review = useReviewStore()
  const blobUrls: string[] = []

  async function enrichReferenceChips() {
    await nextTick()
    const el = rootRef.value
    if (!el) return
    const anchors = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[data-pr-ref]'))
    if (anchors.length === 0) return

    const pending: Array<{ owner: string; repo: string; number: number }> = []
    for (const anchor of anchors) {
      const refStr = anchor.getAttribute('data-pr-ref') ?? ''
      const match = refStr.match(/^([^/]+)\/([^#]+)#(\d+)$/)
      if (!match) continue
      const [, owner, repo, numStr] = match
      const num = Number(numStr)
      const cached = getCachedPRReferenceMeta(owner, repo, num)
      if (cached) {
        applyRefChipMeta(anchor, cached)
      } else if (auth.pat && !review.pr?.isMock) {
        pending.push({ owner, repo, number: num })
      }
    }

    if (pending.length === 0 || !auth.pat) return
    const fetched = await fetchPRReferenceMetadataBatch(auth.pat, pending)
    for (const anchor of anchors) {
      const refStr = anchor.getAttribute('data-pr-ref') ?? ''
      const meta = fetched.get(refStr.toLowerCase())
      if (meta) applyRefChipMeta(anchor, meta)
    }
  }

  async function resolvePrivateVideos() {
    await nextTick()
    const el = rootRef.value
    if (!el || !auth.pat) return
    const videos = el.querySelectorAll<HTMLVideoElement>('video[data-video-attachment]')
    for (const video of videos) {
      if (video.dataset.authResolved) continue
      const rawUrl = video.getAttribute('data-video-attachment')
      if (!rawUrl || !rawUrl.startsWith('https://github.com/user-attachments/assets/')) continue
      video.addEventListener(
        'error',
        async () => {
          if (video.dataset.authResolved) return
          video.dataset.authResolved = '1'
          try {
            const res = await httpFetch(rawUrl, {
              headers: { Authorization: `Bearer ${auth.pat}` },
            })
            if (!res.ok) return
            const blob = await res.blob()
            const objectUrl = URL.createObjectURL(blob)
            blobUrls.push(objectUrl)
            video.src = objectUrl
          } catch {
            // Leave fallback "Open in browser" link usable
          }
        },
        { once: true },
      )
    }
  }

  watch(
    refreshSource,
    () => {
      void resolvePrivateVideos()
      void enrichReferenceChips()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    for (const url of blobUrls) {
      URL.revokeObjectURL(url)
    }
    blobUrls.length = 0
  })

  async function handleMarkdownClick(event: MouseEvent): Promise<boolean> {
    const target = event.target as HTMLElement | null
    const copyBtn = target?.closest('button[data-copy-code]') as HTMLButtonElement | null
    if (copyBtn) {
      event.preventDefault()
      event.stopPropagation()
      const wrapper = copyBtn.closest('div.group')
      const codeEl = wrapper?.querySelector('pre > code')
      const keptLines = codeEl?.querySelectorAll('[data-code-line="keep"]')
      const text =
        keptLines && keptLines.length > 0
          ? Array.from(keptLines)
              .map((lineEl) => lineEl.textContent ?? '')
              .join('\n')
          : (codeEl?.textContent ?? '')
      const ok = await copyToClipboard(text)
      if (ok) {
        copyBtn.textContent = 'Copied!'
        copyBtn.classList.add('text-pine-text')
        setTimeout(() => {
          copyBtn.textContent = 'Copy'
          copyBtn.classList.remove('text-pine-text')
        }, 1500)
      }
      return true
    }

    if (options?.interactiveChecklist?.()) {
      const taskButton = target?.closest('button[data-task-index]') as HTMLButtonElement | null
      if (taskButton) {
        const idx = Number(taskButton.getAttribute('data-task-index'))
        if (!Number.isNaN(idx)) {
          event.preventDefault()
          event.stopPropagation()
          options.onToggleTask?.(idx)
          return true
        }
      }
    }

    const anchor = target?.closest('a[data-external-url]') as HTMLAnchorElement | null
    if (!anchor) return false

    event.preventDefault()
    event.stopPropagation()
    const prRef = anchor.getAttribute('data-pr-ref')
    const prKind = anchor.getAttribute('data-pr-kind')
    const url = anchor.getAttribute('data-external-url')
    if (
      prRef &&
      prKind === 'pull' &&
      url &&
      review.pr &&
      !review.pr.isMock &&
      prRef.toLowerCase().startsWith(`${review.pr.owner.toLowerCase()}/${review.pr.repo.toLowerCase()}#`)
    ) {
      void review.loadPRByUrl(url)
      return true
    }
    if (url) {
      void openExternalUrl(url)
    }
    return true
  }

  return { handleMarkdownClick }
}
