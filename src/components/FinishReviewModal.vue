<script setup lang="ts">
import {
  AlertCircle,
  AlertTriangle,
  BookmarkPlus,
  Check,
  CornerDownRight,
  Loader2,
  MessageSquare,
  Pencil,
  Send,
  Trash2,
  X,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  loadReviewSummaryDraft,
  loadReviewTemplates,
  saveReviewSummaryDraft,
  saveReviewTemplates,
  type ReviewTemplate,
} from '@/services/storage'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'
import type { ReviewEvent } from '@/types/pr'
import { useCommentAutocomplete } from '@/composables/useCommentAutocomplete'
import CommentAutocompletePopover from './CommentAutocompletePopover.vue'
import MarkdownContent from './MarkdownContent.vue'

const DEFAULT_TEMPLATES: ReviewTemplate[] = [
  {
    id: 'builtin-lgtm',
    name: 'LGTM',
    body: 'Looks good to me! Approved.',
  },
  {
    id: 'builtin-nits',
    name: 'LGTM with minor nits',
    body: 'LGTM with a few minor nits — feel free to address or follow up.',
  },
  {
    id: 'builtin-changes',
    name: 'See inline comments',
    body: 'Left a few inline comments — please take a look and let me know what you think.',
  },
  {
    id: 'builtin-tests',
    name: 'Needs tests',
    body: 'Changes look solid overall, though I would love to see unit tests covering the new edge cases.',
  },
]

const review = useReviewStore()
const settings = useSettingsStore()

const summary = ref('')
const summaryTextareaRef = ref<HTMLTextAreaElement | null>(null)
const summaryAutocomplete = useCommentAutocomplete(
  summaryTextareaRef,
  () => summary.value,
  (next) => {
    summary.value = next
  },
)
const selectedEvent = ref<ReviewEvent>('COMMENT')
const summaryPreviewMode = ref(false)
const customTemplates = ref<ReviewTemplate[]>([])
const templateSavedNotice = ref(false)

// Inline draft editing state
const editingDraftId = ref<string | null>(null)
const editingDraftBody = ref('')
const editingDraftError = ref<string | null>(null)
const isSavingDraftEdit = ref(false)

const allTemplates = computed(() => [...DEFAULT_TEMPLATES, ...customTemplates.value])

const unreviewedCount = computed(() =>
  Math.max(0, review.tourSteps.length - review.reviewedCount),
)

const unresolvedThreadCount = computed(() =>
  review.pr ? review.pr.threads.filter((t) => !t.isResolved).length : 0,
)

const approveCompletenessWarning = computed(() => {
  if (selectedEvent.value !== 'APPROVE') return null
  const parts: string[] = []
  if (unreviewedCount.value > 0) {
    parts.push(
      `${unreviewedCount.value} file${unreviewedCount.value === 1 ? '' : 's'} not yet marked reviewed`,
    )
  }
  if (unresolvedThreadCount.value > 0) {
    parts.push(
      `${unresolvedThreadCount.value} unresolved thread${unresolvedThreadCount.value === 1 ? '' : 's'} remaining`,
    )
  }
  return parts.length > 0 ? parts.join(' · ') : null
})

async function hydrateDraftAndTemplates() {
  const [draft, templates] = await Promise.all([
    review.prKey ? loadReviewSummaryDraft(review.prKey) : Promise.resolve(null),
    loadReviewTemplates(),
  ])
  customTemplates.value = templates
  if (draft) {
    summary.value = draft.body
    selectedEvent.value = draft.event
  } else {
    summary.value = ''
    selectedEvent.value = 'COMMENT'
  }
}

watch(
  () => review.prKey,
  () => {
    void hydrateDraftAndTemplates()
  },
  { immediate: true },
)

watch(
  () => review.showFinishModal,
  (open) => {
    if (open) {
      review.submitError = null
      review.submitSuccessMessage = null
      editingDraftId.value = null
      editingDraftError.value = null
      summaryPreviewMode.value = false
      void hydrateDraftAndTemplates()
    } else if (review.prKey) {
      void saveReviewSummaryDraft(review.prKey, {
        body: summary.value,
        event: selectedEvent.value,
      })
    }
  },
)

function startEditingDraft(id: string, body: string) {
  editingDraftId.value = id
  editingDraftBody.value = body
  editingDraftError.value = null
}

function cancelEditingDraft() {
  editingDraftId.value = null
  editingDraftBody.value = ''
  editingDraftError.value = null
}

async function saveEditingDraft(id: string) {
  if (!editingDraftBody.value.trim() || isSavingDraftEdit.value) return
  isSavingDraftEdit.value = true
  editingDraftError.value = null
  try {
    await review.updateDraftComment(id, editingDraftBody.value)
    editingDraftId.value = null
    editingDraftBody.value = ''
  } catch (err) {
    editingDraftError.value = err instanceof Error ? err.message : 'Failed to update comment'
  } finally {
    isSavingDraftEdit.value = false
  }
}

function applyTemplate(tpl: ReviewTemplate) {
  summary.value = summary.value.trim()
    ? `${summary.value.trimEnd()}\n\n${tpl.body}`
    : tpl.body
  summaryPreviewMode.value = false
}

async function saveCurrentAsTemplate() {
  const text = summary.value.trim()
  if (!text) return
  const firstLine = text.split('\n')[0].replace(/[#*`]/g, '').trim()
  const name = firstLine.length > 28 ? `${firstLine.slice(0, 25)}…` : firstLine || 'Custom template'
  const next: ReviewTemplate[] = [
    ...customTemplates.value,
    { id: `tpl-${Date.now()}`, name, body: text },
  ]
  customTemplates.value = next
  await saveReviewTemplates(next)
  templateSavedNotice.value = true
  setTimeout(() => {
    templateSavedNotice.value = false
  }, 1500)
}

async function deleteCustomTemplate(id: string) {
  const next = customTemplates.value.filter((t) => t.id !== id)
  customTemplates.value = next
  await saveReviewTemplates(next)
}

const confirmDeleteDraftId = ref<string | null>(null)
const validationError = ref<string | null>(null)

async function handleDiscardDraftAndClose() {
  summary.value = ''
  selectedEvent.value = 'COMMENT'
  validationError.value = null
  if (review.prKey) {
    await saveReviewSummaryDraft(review.prKey, null)
  }
  review.showFinishModal = false
}

async function handleSaveDraftAndClose() {
  if (review.prKey) {
    await saveReviewSummaryDraft(review.prKey, {
      body: summary.value,
      event: selectedEvent.value,
    })
  }
  review.showFinishModal = false
}

async function handleSubmit() {
  if (review.isSubmittingReview) return
  validationError.value = null
  if (
    selectedEvent.value === 'REQUEST_CHANGES' &&
    !summary.value.trim() &&
    review.draftComments.length === 0
  ) {
    validationError.value =
      'Requesting changes requires either an overall review summary or at least one inline comment.'
    return
  }
  const ok = await review.submitCompleteReview(selectedEvent.value, summary.value)
  if (ok) {
    summary.value = ''
    selectedEvent.value = 'COMMENT'
    if (review.prKey) {
      await saveReviewSummaryDraft(review.prKey, null)
    }
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!review.showFinishModal || !review.pr || settings.isOpen) return
  if (editingDraftId.value) return
  if (approveCompletenessWarning.value) return
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.altKey) {
    e.preventDefault()
    void handleSubmit()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Transition name="modal-pop">
    <div
      v-if="review.showFinishModal && review.pr"
      class="stroll-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      @click.self="!review.isSubmittingReview && (review.showFinishModal = false)"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Finish Review"
        class="stroll-elevated flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-canvas-subtle"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <div class="flex items-center gap-2">
            <Send class="h-4 w-4 text-pine" />
            <h2 class="text-sm font-semibold text-ink">
              Finish Review — {{ review.pr.owner }}/{{ review.pr.repo }}#{{ review.pr.number }}
            </h2>
          </div>
          <button
            class="rounded-lg p-1 text-ink-muted hover:bg-canvas-elevated hover:text-ink disabled:opacity-40"
            :disabled="review.isSubmittingReview"
            aria-label="Close finish review modal"
            @click="review.showFinishModal = false"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="flex-1 space-y-4 overflow-y-auto p-5">
          <!-- Pending Draft Comments Summary -->
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-ink-secondary">
                Pending Inline Comments ({{ review.draftComments.length }})
              </span>
              <span class="text-ink-muted">
                {{ review.reviewedCount }} / {{ review.tourSteps.length }} files marked reviewed
              </span>
            </div>

            <div
              v-if="review.draftComments.length === 0"
              class="rounded-xl border border-border-muted bg-canvas-inset p-3 text-xs text-ink-muted"
            >
              No pending inline comments. You can still submit an overall review summary below.
            </div>

            <div v-else class="max-h-48 space-y-1.5 overflow-x-hidden overflow-y-auto pr-1">
              <div
                v-for="draft in review.draftComments"
                :key="draft.id"
                class="rounded-xl border border-ochre-border bg-ochre-soft p-2.5 text-xs"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <div class="font-mono text-[11px] font-medium break-all text-ochre-text">
                      {{ draft.path
                      }}<template v-if="draft.subjectType === 'FILE'">
                        <span class="ml-1 font-sans text-[10px] text-ink-muted">(file)</span>
                      </template><template v-else>:{{
                        draft.startLine && draft.startLine !== draft.line
                          ? `${draft.startLine}-${draft.line}`
                          : draft.line
                      }}</template>
                    </div>

                    <div v-if="editingDraftId === draft.id" class="mt-2 space-y-1.5">
                      <textarea
                        v-model="editingDraftBody"
                        rows="3"
                        class="w-full rounded-lg border border-border bg-canvas-inset px-2.5 py-1.5 text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
                        @keydown.meta.enter.prevent="saveEditingDraft(draft.id)"
                        @keydown.ctrl.enter.prevent="saveEditingDraft(draft.id)"
                        @keydown.esc.prevent="cancelEditingDraft"
                      />
                      <p v-if="editingDraftError" class="text-[11px] text-crimson-text">
                        {{ editingDraftError }}
                      </p>
                      <div class="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          class="rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] text-ink-secondary hover:bg-canvas-elevated"
                          @click="cancelEditingDraft"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-lg bg-terra px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-terra-hover disabled:opacity-40"
                          :disabled="!editingDraftBody.trim() || isSavingDraftEdit"
                          @click="saveEditingDraft(draft.id)"
                        >
                          <Loader2 v-if="isSavingDraftEdit" class="h-3 w-3 animate-spin" />
                          <span>Save</span>
                        </button>
                      </div>
                    </div>
                    <p v-else class="mt-0.5 line-clamp-2 break-words text-ink">{{ draft.body }}</p>
                  </div>
                  <div v-if="editingDraftId !== draft.id" class="flex shrink-0 items-center gap-2">
                    <button
                      class="text-ink-muted hover:text-ink"
                      title="Edit comment inline"
                      aria-label="Edit comment inline"
                      @click="startEditingDraft(draft.id, draft.body)"
                    >
                      <Pencil class="h-3.5 w-3.5" />
                    </button>
                    <button
                      class="text-ink-muted hover:text-ink"
                      title="Go to comment in file"
                      aria-label="Go to comment in file"
                      @click="review.focusDraftComment(draft.id)"
                    >
                      <CornerDownRight class="h-3.5 w-3.5" />
                    </button>
                    <template v-if="confirmDeleteDraftId === draft.id">
                      <button
                        type="button"
                        class="rounded bg-crimson px-1.5 py-0.5 text-[10px] font-semibold text-white hover:opacity-90"
                        @click="
                          confirmDeleteDraftId = null;
                          review.deleteDraftComment(draft.id)
                        "
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        class="rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] text-ink-secondary hover:bg-canvas-elevated"
                        @click="confirmDeleteDraftId = null"
                      >
                        Keep
                      </button>
                    </template>
                    <button
                      v-else
                      class="text-ink-muted hover:text-crimson-text"
                      title="Delete pending comment"
                      aria-label="Delete pending comment"
                      @click="confirmDeleteDraftId = draft.id"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Review Summary -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="block text-xs font-medium text-ink-secondary">Review Summary</label>
              <div class="flex items-center gap-2">
                <button
                  v-if="summary.trim()"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
                  title="Save current summary as a reusable template"
                  @click="saveCurrentAsTemplate"
                >
                  <BookmarkPlus class="h-3 w-3" />
                  <span>{{ templateSavedNotice ? 'Saved!' : 'Save template' }}</span>
                </button>
                <div class="inline-flex rounded-md border border-border bg-canvas p-0.5 text-[10px]">
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 transition-colors"
                    :class="!summaryPreviewMode ? 'bg-canvas-elevated font-semibold text-ink' : 'text-ink-muted hover:text-ink'"
                    @click="summaryPreviewMode = false"
                  >
                    Write
                  </button>
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 transition-colors"
                    :class="summaryPreviewMode ? 'bg-canvas-elevated font-semibold text-ink' : 'text-ink-muted hover:text-ink'"
                    @click="summaryPreviewMode = true"
                  >
                    Preview
                  </button>
                </div>
              </div>
            </div>

            <!-- Quick-insert templates -->
            <div class="flex flex-wrap items-center gap-1.5">
              <div
                v-for="tpl in allTemplates"
                :key="tpl.id"
                class="inline-flex items-center rounded-full border border-border-muted bg-canvas text-[10.5px] text-ink-secondary"
              >
                <button
                  type="button"
                  class="rounded-full px-2 py-0.5 transition-colors hover:text-ink"
                  :title="tpl.body"
                  @click="applyTemplate(tpl)"
                >
                  {{ tpl.name }}
                </button>
                <button
                  v-if="tpl.id.startsWith('tpl-')"
                  type="button"
                  class="pr-1.5 text-ink-faint hover:text-crimson-text"
                  title="Remove saved template"
                  aria-label="Remove saved template"
                  @click="deleteCustomTemplate(tpl.id)"
                >
                  <X class="h-2.5 w-2.5" />
                </button>
              </div>
            </div>

            <div
              v-if="summaryPreviewMode"
              class="min-h-[92px] max-h-44 overflow-y-auto rounded-xl border border-border bg-canvas-inset px-3 py-2 text-xs text-ink-secondary"
            >
              <MarkdownContent v-if="summary.trim()" :content="summary" />
              <span v-else class="text-ink-faint">Nothing to preview.</span>
            </div>
            <textarea
              v-else
              ref="summaryTextareaRef"
              v-model="summary"
              rows="4"
              placeholder="Leave an overall summary of your review..."
              class="w-full rounded-xl border border-border bg-canvas-inset px-3 py-2 text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
              @input="summaryAutocomplete.onInputOrCursor()"
              @click="summaryAutocomplete.onInputOrCursor()"
              @keydown="summaryAutocomplete.handleKeydown($event) && $event.stopPropagation()"
              @blur="summaryAutocomplete.close()"
            />
            <CommentAutocompletePopover
              :open="summaryAutocomplete.isOpen.value"
              :trigger="summaryAutocomplete.trigger.value"
              :options="summaryAutocomplete.options.value"
              :active-index="summaryAutocomplete.activeIndex.value"
              :is-loading="summaryAutocomplete.isLoading.value"
              :coords="summaryAutocomplete.coords.value"
              @select="summaryAutocomplete.selectOption"
              @hover="summaryAutocomplete.activeIndex.value = $event"
            />
          </div>

          <!-- Verdict Selector -->
          <div class="grid grid-cols-3 gap-2">
            <button
              class="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
              :class="
                selectedEvent === 'COMMENT'
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
              "
              @click="selectedEvent = 'COMMENT'"
            >
              <MessageSquare class="h-3.5 w-3.5" />
              <span>Comment</span>
            </button>

            <button
              class="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
              :class="
                selectedEvent === 'APPROVE'
                  ? 'border-pine-border bg-pine-soft text-pine-text'
                  : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
              "
              @click="selectedEvent = 'APPROVE'"
            >
              <Check class="h-3.5 w-3.5" />
              <span>Approve</span>
            </button>

            <button
              class="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
              :class="
                selectedEvent === 'REQUEST_CHANGES'
                  ? 'border-crimson-border bg-crimson-soft text-crimson-text'
                  : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
              "
              @click="selectedEvent = 'REQUEST_CHANGES'"
            >
              <AlertTriangle class="h-3.5 w-3.5" />
              <span>Request Changes</span>
            </button>
          </div>

          <div
            v-if="approveCompletenessWarning"
            role="status"
            class="flex items-center gap-2 rounded-xl border border-ochre-border bg-ochre-soft px-3 py-2 text-xs text-ochre-text"
          >
            <AlertCircle class="h-3.5 w-3.5 shrink-0" />
            <span>{{ approveCompletenessWarning }}</span>
          </div>

          <div
            v-if="validationError || review.submitError"
            role="alert"
            class="rounded-xl border border-crimson-border bg-crimson-soft px-3 py-2 text-xs text-crimson-text"
          >
            {{ validationError ?? review.submitError }}
          </div>

          <div
            v-if="review.submitSuccessMessage"
            class="rounded-xl border border-pine-border bg-pine-soft px-3 py-2 text-xs text-pine-text"
          >
            {{ review.submitSuccessMessage }}
          </div>
        </div>

        <div class="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span class="text-[11px] text-ink-faint">Ctrl+↵ / ⌘↵ to submit</span>
          <div class="flex items-center gap-2">
            <button
              v-if="summary.trim() || selectedEvent !== 'COMMENT'"
              type="button"
              :disabled="review.isSubmittingReview"
              class="rounded-xl border border-border bg-canvas px-3 py-1.5 text-xs text-ink-muted hover:text-crimson-text disabled:opacity-40"
              title="Clear summary & verdict and close"
              @click="handleDiscardDraftAndClose"
            >
              Discard
            </button>
            <button
              type="button"
              :disabled="review.isSubmittingReview"
              class="rounded-xl border border-border bg-canvas px-3.5 py-1.5 text-xs text-ink-secondary hover:bg-canvas-elevated disabled:opacity-40"
              title="Keep summary & verdict saved for this PR and close"
              @click="handleSaveDraftAndClose"
            >
              Save Draft
            </button>
            <button
              class="inline-flex items-center gap-1.5 rounded-xl bg-pine px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-pine-hover disabled:opacity-40"
              :disabled="review.isSubmittingReview"
              :aria-busy="review.isSubmittingReview"
              @click="handleSubmit"
            >
              <Loader2 v-if="review.isSubmittingReview" class="h-3.5 w-3.5 animate-spin" />
              <span>Submit Review</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
