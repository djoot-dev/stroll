<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  fetchPRReferenceMetadataBatch,
  getCachedPRReferenceMeta,
  type PRReferenceMeta,
} from '@/services/github'
import { httpFetch } from '@/services/http'
import { renderSafeMarkdown } from '@/services/markdown'
import { copyToClipboard, openExternalUrl } from '@/services/native'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'

const props = defineProps<{
  content: string
  originalLines?: string[]
  interactiveChecklist?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-task', index: number): void
}>()

const auth = useAuthStore()
const review = useReviewStore()
const rootRef = ref<HTMLElement | null>(null)
const blobUrls: string[] = []

const renderedHtml = computed(() =>
  renderSafeMarkdown(props.content, {
    originalLines: props.originalLines,
    interactiveChecklist: props.interactiveChecklist,
    repoContext: review.pr ? { owner: review.pr.owner, repo: review.pr.repo } : undefined,
  }),
)

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

watch(renderedHtml, () => {
  void resolvePrivateVideos()
  void enrichReferenceChips()
}, { immediate: true })

onBeforeUnmount(() => {
  for (const url of blobUrls) {
    URL.revokeObjectURL(url)
  }
  blobUrls.length = 0
})

async function handleClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement | null
  const copyBtn = target?.closest('button[data-copy-code]') as HTMLButtonElement | null
  if (copyBtn) {
    event.preventDefault()
    const wrapper = copyBtn.closest('div.group')
    const codeEl = wrapper?.querySelector('pre > code')
    const text = codeEl?.textContent ?? ''
    const ok = await copyToClipboard(text)
    if (ok) {
      copyBtn.textContent = 'Copied!'
      copyBtn.classList.add('text-pine-text')
      setTimeout(() => {
        copyBtn.textContent = 'Copy'
        copyBtn.classList.remove('text-pine-text')
      }, 1500)
    }
    return
  }
  if (props.interactiveChecklist) {
    const taskButton = target?.closest('button[data-task-index]') as HTMLButtonElement | null
    if (taskButton) {
      const idx = Number(taskButton.getAttribute('data-task-index'))
      if (!Number.isNaN(idx)) {
        event.preventDefault()
        emit('toggle-task', idx)
        return
      }
    }
  }
  const anchor = target?.closest('a[data-external-url]') as HTMLAnchorElement | null
  if (!anchor) return
  event.preventDefault()
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
    return
  }
  if (url) {
    void openExternalUrl(url)
  }
}
</script>

<template>
  <div
    v-if="renderedHtml"
    ref="rootRef"
    class="min-w-0 break-words"
    @click="handleClick"
    v-html="renderedHtml"
  />
</template>
