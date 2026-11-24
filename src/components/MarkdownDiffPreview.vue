<script setup lang="ts">
import { Code2, MessageSquare, MessageSquarePlus, Pencil, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useMarkdownDom } from '@/composables/useMarkdownDom'
import type { MarkdownDiffBlock, MarkdownDiffLineAnchor } from '@/services/markdownDiff'
import type { DiffSide, DraftComment, ReviewThread } from '@/types/pr'
import CommentComposer from './CommentComposer.vue'
import MarkdownContent from './MarkdownContent.vue'
import ReviewThreadCard from './ReviewThreadCard.vue'

const props = defineProps<{
  blocks: MarkdownDiffBlock[]
  plainSource: string
  showChanges: boolean
  threads: ReviewThread[]
  drafts: DraftComment[]
  showUnresolvedOnly: boolean
  editingDraftId: string | null
  draftEditError: string | null
  flashDraftId: string | null
  activeComposer: { blockId: string; line: number; side: DiffSide } | null
  flashBlockId: string | null
  getOriginalCode: (line: number, side: DiffSide, startLine?: number) => string | undefined
  getOriginalLines: (line: number, side: DiffSide, startLine?: number) => string[] | undefined
}>()

const emit = defineEmits<{
  (e: 'jump-to-source', anchor: MarkdownDiffLineAnchor): void
  (e: 'open-comment', blockId: string, anchor: MarkdownDiffLineAnchor): void
  (e: 'submit-comment', body: string): void
  (e: 'cancel-comment'): void
  (e: 'start-edit-draft', id: string): void
  (e: 'update-draft', id: string, body: string): void
  (e: 'cancel-edit-draft'): void
  (e: 'delete-draft', id: string): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const { handleMarkdownClick } = useMarkdownDom(rootRef, () => [props.blocks, props.showChanges])

function blockMatchesAnchor(block: MarkdownDiffBlock, line: number | null, side: DiffSide): boolean {
  if (line === null) return false
  if (side === 'LEFT' && block.baseRange) {
    return line >= block.baseRange.startLine && line <= block.baseRange.endLine
  }
  if (side === 'RIGHT' && block.headRange) {
    return line >= block.headRange.startLine && line <= block.headRange.endLine
  }
  return false
}

const visibleThreads = computed(() =>
  props.showUnresolvedOnly ? props.threads.filter((t) => !t.isResolved) : props.threads,
)

const threadsByBlockId = computed(() => {
  const map = new Map<string, ReviewThread[]>()
  for (const thread of visibleThreads.value) {
    const match = props.blocks.find((b) => blockMatchesAnchor(b, thread.line, thread.side))
    if (!match) continue
    const list = map.get(match.id) ?? []
    list.push(thread)
    map.set(match.id, list)
  }
  return map
})

const draftsByBlockId = computed(() => {
  const map = new Map<string, DraftComment[]>()
  for (const draft of props.drafts) {
    const match = props.blocks.find((b) => blockMatchesAnchor(b, draft.line, draft.side))
    if (!match) continue
    const list = map.get(match.id) ?? []
    list.push(draft)
    map.set(match.id, list)
  }
  return map
})

async function handleBlockBodyClick(event: MouseEvent, block: MarkdownDiffBlock) {
  const handled = await handleMarkdownClick(event)
  if (handled) return

  if (block.changeKind === 'unchanged' || !block.jumpAnchor) return
  const target = event.target as HTMLElement | null
  if (target?.closest('a, button, input, textarea, video')) return
  const selection = typeof window !== 'undefined' ? window.getSelection()?.toString() : ''
  if (selection) return

  emit('jump-to-source', block.jumpAnchor)
}

function changeLabel(kind: MarkdownDiffBlock['changeKind']): string {
  if (kind === 'added') return 'Added'
  if (kind === 'removed') return 'Removed'
  if (kind === 'modified') return 'Modified'
  return ''
}

function changeBadgeClass(kind: MarkdownDiffBlock['changeKind']): string {
  if (kind === 'added') return 'border-pine-border bg-pine-soft text-pine-text'
  if (kind === 'removed') return 'border-crimson-border bg-crimson-soft text-crimson-text'
  return 'border-terra-border bg-terra-soft text-terra-text'
}

function blockContainerClass(block: MarkdownDiffBlock): string {
  const flash = props.flashBlockId === block.id ? 'ring-2 ring-terra bg-terra-soft/25' : ''
  if (block.changeKind === 'added') {
    return `group/md my-2 rounded-lg border-l-2 border-l-diff-add-border bg-diff-add/25 px-3 py-1.5 transition-shadow ${flash}`
  }
  if (block.changeKind === 'removed') {
    return `group/md my-2 rounded-lg border-l-2 border-l-diff-del-border bg-diff-del/25 px-3 py-1.5 transition-shadow ${flash}`
  }
  if (block.changeKind === 'modified') {
    return `group/md my-2 rounded-lg border border-border-muted border-l-2 border-l-terra-border bg-canvas-subtle/50 px-3 py-1.5 transition-shadow ${flash}`
  }
  return `my-1 transition-shadow ${flash}`
}
</script>

<template>
  <div class="mx-auto max-w-3xl text-[13px] leading-relaxed text-ink-secondary">
    <MarkdownContent
      v-if="!showChanges"
      :content="plainSource"
    />

    <div
      v-else
      ref="rootRef"
      class="min-w-0 break-words"
    >
      <template v-for="block in blocks" :key="block.id">
        <div
          :data-md-block-id="block.id"
          :data-md-change-kind="block.changeKind"
          :class="blockContainerClass(block)"
        >
          <!-- Changed block action bar -->
          <div
            v-if="block.changeKind !== 'unchanged'"
            class="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px]"
          >
            <div class="flex items-center gap-1.5">
              <span
                class="inline-flex items-center rounded border px-1.5 py-0.2 font-medium"
                :class="changeBadgeClass(block.changeKind)"
              >
                {{ changeLabel(block.changeKind) }}
              </span>
              <span
                v-if="(threadsByBlockId.get(block.id)?.length ?? 0) + (draftsByBlockId.get(block.id)?.length ?? 0) > 0"
                class="inline-flex items-center gap-1 rounded border border-border bg-canvas px-1.5 py-0.2 text-ink-muted"
              >
                <MessageSquare class="h-2.5 w-2.5" />
                <span>
                  {{ (threadsByBlockId.get(block.id)?.length ?? 0) + (draftsByBlockId.get(block.id)?.length ?? 0) }}
                </span>
              </span>
            </div>

            <div class="flex items-center gap-1.5 opacity-85 transition-opacity group-hover/md:opacity-100">
              <button
                v-if="block.jumpAnchor"
                type="button"
                data-preview-jump-source
                class="inline-flex items-center gap-1 rounded border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
                title="View matching hunk in source diff"
                @click.stop="emit('jump-to-source', block.jumpAnchor)"
              >
                <Code2 class="h-3 w-3" />
                <span>View in diff</span>
              </button>
              <button
                v-if="block.commentAnchor"
                type="button"
                data-preview-add-comment
                class="inline-flex items-center gap-1 rounded border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:border-terra-border hover:text-terra-text"
                title="Comment on this changed block"
                @click.stop="emit('open-comment', block.id, block.commentAnchor)"
              >
                <MessageSquarePlus class="h-3 w-3" />
                <span>Comment</span>
              </button>
            </div>
          </div>

          <!-- Modified paired block (removed base + added head) -->
          <div
            v-if="block.changeKind === 'modified' && block.removedHtml && block.addedHtml"
            class="cursor-pointer space-y-1.5 overflow-hidden rounded-md"
            title="Click to view in source diff"
            @click="handleBlockBodyClick($event, block)"
          >
            <div
              class="rounded border-l-2 border-l-diff-del-border bg-diff-del/35 px-2.5 py-1 text-diff-del-text line-through opacity-85"
              v-html="block.removedHtml"
            />
            <div
              class="rounded border-l-2 border-l-diff-add-border bg-diff-add/35 px-2.5 py-1 text-ink"
              v-html="block.addedHtml"
            />
          </div>

          <!-- Single HTML body (unchanged, added, removed, or sub-block diff) -->
          <div
            v-else
            :class="[
              block.changeKind !== 'unchanged' ? 'cursor-pointer' : '',
              block.changeKind === 'removed' ? 'text-diff-del-text line-through opacity-85' : '',
            ]"
            :title="block.changeKind !== 'unchanged' ? 'Click to view in source diff' : undefined"
            @click="handleBlockBodyClick($event, block)"
            v-html="block.html"
          />

          <!-- Attached review threads -->
          <div
            v-for="thread in threadsByBlockId.get(block.id) ?? []"
            :key="thread.id"
            class="mt-2 font-sans"
          >
            <ReviewThreadCard :thread="thread" />
          </div>

          <!-- Attached pending drafts -->
          <div
            v-for="draft in draftsByBlockId.get(block.id) ?? []"
            :key="draft.id"
            class="mt-2 font-sans"
            :data-draft-id="draft.id"
          >
            <template v-if="editingDraftId === draft.id">
              <CommentComposer
                :line="draft.line"
                :side="draft.side"
                :start-line="draft.startLine"
                :start-side="draft.startSide"
                :original-code="getOriginalCode(draft.line, draft.side, draft.startLine)"
                :initial-body="draft.body"
                @submit="(body) => emit('update-draft', draft.id, body)"
                @cancel="emit('cancel-edit-draft')"
              />
              <p v-if="draftEditError" class="mx-3 text-[11px] text-crimson-text">
                {{ draftEditError }}
              </p>
            </template>
            <div
              v-else
              class="animate-pop-in rounded-xl border border-ochre-border bg-ochre-soft p-3 transition-shadow"
              :class="flashDraftId === draft.id ? 'ring-2 ring-ochre-text' : ''"
            >
              <div class="flex items-center justify-between text-[11px]">
                <span class="font-semibold text-ochre-text">
                  Pending Draft (Line {{ draft.line }} · {{ draft.side === 'LEFT' ? 'Base' : 'Head' }})
                </span>
                <div class="flex items-center gap-3">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                    title="Edit draft"
                    @click.stop="emit('start-edit-draft', draft.id)"
                  >
                    <Pencil class="h-3 w-3" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-ink-muted hover:text-crimson-text"
                    title="Delete draft"
                    @click.stop="emit('delete-draft', draft.id)"
                  >
                    <Trash2 class="h-3 w-3" />
                    <span>Discard</span>
                  </button>
                </div>
              </div>
              <MarkdownContent
                :content="draft.body"
                :original-lines="getOriginalLines(draft.line, draft.side, draft.startLine)"
                class="mt-1 text-xs leading-relaxed text-ink"
              />
            </div>
          </div>

          <!-- Inline composer for this block -->
          <div
            v-if="activeComposer?.blockId === block.id"
            class="mt-2 font-sans"
          >
            <CommentComposer
              :line="activeComposer.line"
              :side="activeComposer.side"
              :original-code="getOriginalCode(activeComposer.line, activeComposer.side)"
              @submit="(body) => emit('submit-comment', body)"
              @cancel="emit('cancel-comment')"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
