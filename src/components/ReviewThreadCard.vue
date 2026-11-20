<script setup lang="ts">
import { CheckCircle2, CornerDownRight, Loader2, Pencil, RotateCcw, Trash2 } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import type { ReviewThread } from '@/types/pr'
import MarkdownContent from './MarkdownContent.vue'
import ReactionBar from './ReactionBar.vue'

const props = defineProps<{
  thread: ReviewThread
}>()

const auth = useAuthStore()
const review = useReviewStore()

const originalLinesForThread = computed<string[] | undefined>(() => {
  if (props.thread.subjectType === 'FILE') return undefined
  const file = review.pr?.files.find((f) => f.path === props.thread.path)
  if (!file) return undefined
  const content = props.thread.side === 'LEFT' ? file.baseContent : file.headContent
  if (!content) return undefined
  const all = content.split('\n')
  const start = Math.max(1, props.thread.startLine ?? props.thread.line)
  const end = Math.min(all.length, props.thread.line)
  if (start > end) return undefined
  return all.slice(start - 1, end)
})

const isReplying = ref(false)
const replyBody = ref('')
const isSubmitting = ref(false)
const isTogglingResolve = ref(false)
const editingCommentId = ref<string | null>(null)
const editBody = ref('')
const isSavingEdit = ref(false)
const deletingCommentId = ref<string | null>(null)
const error = ref<string | null>(null)
const collapsed = ref(props.thread.isResolved)

function canModifyComment(authorLogin: string): boolean {
  if (review.pr?.isMock) return true
  return Boolean(auth.viewer?.login && auth.viewer.login === authorLogin)
}

function startEdit(commentId: string, body: string) {
  editingCommentId.value = commentId
  editBody.value = body
  error.value = null
}

async function handleSaveEdit(commentId: string) {
  if (!editBody.value.trim() || isSavingEdit.value) return
  isSavingEdit.value = true
  error.value = null
  try {
    await review.editReviewComment(props.thread.id, commentId, editBody.value)
    editingCommentId.value = null
    editBody.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update comment'
  } finally {
    isSavingEdit.value = false
  }
}

async function handleDeleteComment(commentId: string) {
  if (deletingCommentId.value) return
  deletingCommentId.value = commentId
  error.value = null
  try {
    await review.deleteReviewComment(props.thread.id, commentId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete comment'
  } finally {
    deletingCommentId.value = null
  }
}

async function handleReply() {
  if (!replyBody.value.trim() || isSubmitting.value) return
  isSubmitting.value = true
  error.value = null
  try {
    await review.replyToThread(props.thread.id, replyBody.value)
    replyBody.value = ''
    isReplying.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to post reply'
  } finally {
    isSubmitting.value = false
  }
}

async function handleToggleResolve() {
  if (isTogglingResolve.value) return
  isTogglingResolve.value = true
  error.value = null
  try {
    await review.toggleThreadResolved(props.thread.id)
    collapsed.value = props.thread.isResolved
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update thread state'
  } finally {
    isTogglingResolve.value = false
  }
}
</script>

<template>
  <div
    class="stroll-card my-2 mx-3 overflow-hidden rounded-xl border bg-canvas-subtle font-sans transition-colors"
    :class="thread.isResolved ? 'border-pine-border opacity-85' : 'border-border'"
    @click.stop
  >
    <!-- Thread Header -->
    <div class="flex items-center justify-between gap-2 border-b border-border-muted bg-canvas-elevated/50 px-3 py-1.5 text-[11px]">
      <div class="flex items-center gap-2">
        <span class="font-mono text-ink-muted">
          {{
            thread.subjectType === 'FILE'
              ? 'File comment'
              : thread.startLine && thread.startLine !== thread.line
                ? `Lines ${thread.startLine}–${thread.line}`
                : `Line ${thread.line}`
          }}
        </span>
        <span
          v-if="thread.isResolved"
          class="inline-flex items-center gap-1 rounded-md border border-pine-border bg-pine-soft px-1.5 py-0.2 text-[10px] font-medium text-pine-text"
        >
          <CheckCircle2 class="h-2.5 w-2.5" />
          Resolved
        </span>
        <span
          v-if="thread.isOutdated"
          class="rounded-md border border-ochre-border bg-ochre-soft px-1.5 py-0.2 text-[10px] text-ochre-text"
        >
          Outdated
        </span>
        <button
          v-if="thread.isResolved"
          class="text-[10px] text-ink-muted hover:text-ink"
          @click="collapsed = !collapsed"
        >
          {{ collapsed ? 'Show conversation' : 'Hide' }}
        </button>
      </div>

      <button
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:bg-canvas-elevated disabled:opacity-40"
        :disabled="isTogglingResolve"
        :aria-busy="isTogglingResolve"
        @click="handleToggleResolve"
      >
        <Loader2 v-if="isTogglingResolve" class="h-3 w-3 animate-spin" />
        <RotateCcw v-else-if="thread.isResolved" class="h-3 w-3" />
        <CheckCircle2 v-else class="h-3 w-3 text-pine" />
        <span>{{ thread.isResolved ? 'Unresolve' : 'Resolve' }}</span>
      </button>
    </div>

    <!-- Comments & Reply -->
    <div v-if="!collapsed" class="divide-y divide-border-muted">
      <div
        v-for="comment in thread.comments"
        :key="comment.id"
        class="space-y-1.5 px-3 py-2.5"
      >
        <div class="flex items-center justify-between gap-2 text-[11px]">
          <span class="font-semibold text-ink">@{{ comment.author.login }}</span>
          <div class="flex items-center gap-2">
            <span class="text-ink-faint">
              {{ new Date(comment.createdAt).toLocaleString() }}
            </span>
            <template v-if="canModifyComment(comment.author.login)">
              <button
                type="button"
                title="Edit comment"
                class="rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-elevated hover:text-ink"
                @click="startEdit(comment.id, comment.body)"
              >
                <Pencil class="h-3 w-3" />
              </button>
              <button
                type="button"
                title="Delete comment"
                class="rounded p-0.5 text-ink-faint transition-colors hover:bg-crimson-soft hover:text-crimson-text disabled:opacity-40"
                :disabled="deletingCommentId === comment.id"
                :aria-busy="deletingCommentId === comment.id"
                @click="handleDeleteComment(comment.id)"
              >
                <Loader2 v-if="deletingCommentId === comment.id" class="h-3 w-3 animate-spin" />
                <Trash2 v-else class="h-3 w-3" />
              </button>
            </template>
          </div>
        </div>

        <div v-if="editingCommentId === comment.id" class="space-y-2 pt-1">
          <textarea
            v-model="editBody"
            rows="3"
            class="w-full rounded-lg border border-border bg-canvas-inset px-2.5 py-1.5 text-xs text-ink focus:border-terra focus:outline-none"
            @keydown.meta.enter.prevent="handleSaveEdit(comment.id)"
            @keydown.ctrl.enter.prevent="handleSaveEdit(comment.id)"
            @keydown.esc.prevent="editingCommentId = null"
          />
          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] text-ink-secondary hover:bg-canvas-elevated"
              @click="editingCommentId = null"
            >
              Cancel
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg bg-terra px-3 py-1 text-[11px] font-semibold text-white hover:bg-terra-hover disabled:opacity-40"
              :disabled="isSavingEdit || !editBody.trim()"
              :aria-busy="isSavingEdit"
              @click="handleSaveEdit(comment.id)"
            >
              <Loader2 v-if="isSavingEdit" class="h-3 w-3 animate-spin" />
              <span>Save</span>
            </button>
          </div>
        </div>
        <template v-else>
          <MarkdownContent
            :content="comment.body"
            :original-lines="originalLinesForThread"
            class="text-xs leading-relaxed text-ink-secondary"
          />
          <ReactionBar :subject-id="comment.id" :reactions="comment.reactions" />
        </template>
      </div>

      <!-- Inline Reply Area -->
      <div class="bg-canvas/40 px-3 py-2">
        <div v-if="!isReplying" class="flex items-center">
          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas-subtle px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:border-terra-border hover:text-terra-text"
            @click="isReplying = true"
          >
            <CornerDownRight class="h-3 w-3" />
            <span>Reply…</span>
          </button>
        </div>

        <div v-else class="animate-pop-in space-y-2">
          <textarea
            v-model="replyBody"
            rows="2"
            placeholder="Write a reply to this thread…"
            class="w-full rounded-lg border border-border bg-canvas-inset px-2.5 py-1.5 text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
            @keydown.meta.enter.prevent="handleReply"
            @keydown.ctrl.enter.prevent="handleReply"
            @keydown.esc.prevent="isReplying = false"
          />

          <p v-if="error" class="text-[11px] text-crimson-text">{{ error }}</p>

          <div class="flex items-center justify-end gap-2">
            <button
              class="rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] text-ink-secondary hover:bg-canvas-elevated"
              @click="isReplying = false"
            >
              Cancel
            </button>
            <button
              class="inline-flex items-center gap-1 rounded-lg bg-terra px-3 py-1 text-[11px] font-semibold text-white hover:bg-terra-hover disabled:opacity-40"
              :disabled="isSubmitting || !replyBody.trim()"
              :aria-busy="isSubmitting"
              @click="handleReply"
            >
              <Loader2 v-if="isSubmitting" class="h-3 w-3 animate-spin" />
              <span>Reply</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
