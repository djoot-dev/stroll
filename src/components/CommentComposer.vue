<script setup lang="ts">
import { FileDiff } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import MarkdownContent from './MarkdownContent.vue'

const props = defineProps<{
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
  originalCode?: string
}>()

const emit = defineEmits<{
  (e: 'submit', body: string): void
  (e: 'cancel'): void
}>()

const body = ref('')
const previewMode = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const originalLines = computed(() =>
  props.originalCode !== undefined ? props.originalCode.split('\n') : undefined,
)

onMounted(() => {
  textareaRef.value?.focus()
})

function insertSuggestion() {
  const snippet = props.originalCode ?? ''
  const block = `\`\`\`suggestion\n${snippet}\n\`\`\``
  body.value = body.value.trim() ? `${body.value.trimEnd()}\n\n${block}\n` : `${block}\n`
  previewMode.value = false
  requestAnimationFrame(() => textareaRef.value?.focus())
}

function handleSubmit() {
  if (!body.value.trim()) return
  emit('submit', body.value.trim())
  body.value = ''
}
</script>

<template>
  <div class="stroll-card my-2 mx-3 rounded-xl border border-terra-border bg-canvas-subtle p-3">
    <div class="mb-2 flex items-center justify-between gap-2 text-[11px] text-ink-muted">
      <div class="flex items-center gap-2">
        <span>
          <template v-if="props.startLine !== undefined && props.startLine !== props.line">
            Add pending comment on lines
            <span class="font-mono font-semibold text-terra-text">
              {{ props.startLine }}–{{ props.line }}
            </span>
          </template>
          <template v-else>
            Add pending comment on line
            <span class="font-mono font-semibold text-terra-text">
              {{ props.side === 'LEFT' ? 'old ' : '' }}{{ props.line }}
            </span>
          </template>
        </span>

        <div class="inline-flex rounded-md border border-border bg-canvas p-0.5 text-[10px]">
          <button
            type="button"
            class="rounded px-1.5 py-0.5 transition-colors"
            :class="!previewMode ? 'bg-canvas-elevated font-semibold text-ink' : 'text-ink-muted hover:text-ink'"
            @click="previewMode = false"
          >
            Write
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-0.5 transition-colors"
            :class="previewMode ? 'bg-canvas-elevated font-semibold text-ink' : 'text-ink-muted hover:text-ink'"
            @click="previewMode = true"
          >
            Preview
          </button>
        </div>
      </div>
      <span class="text-ink-faint">Saved locally until Finish Review</span>
    </div>

    <div
      v-if="previewMode"
      class="min-h-[76px] rounded-lg border border-border bg-canvas-inset px-3 py-2 text-xs text-ink-secondary"
    >
      <MarkdownContent v-if="body.trim()" :content="body" :original-lines="originalLines" />
      <span v-else class="text-ink-faint">Nothing to preview.</span>
    </div>

    <textarea
      v-else
      ref="textareaRef"
      v-model="body"
      rows="3"
      placeholder="Write a review comment (Markdown & ```suggestion supported)..."
      class="w-full rounded-lg border border-border bg-canvas-inset px-3 py-2 font-sans text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
      @keydown.meta.enter.prevent="handleSubmit"
      @keydown.ctrl.enter.prevent="handleSubmit"
      @keydown.esc.prevent="emit('cancel')"
    />

    <div class="mt-2 flex items-center justify-between gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:border-pine-border hover:text-pine-text"
        title="Insert a GitHub code suggestion block"
        @click="insertSuggestion"
      >
        <FileDiff class="h-3 w-3" />
        <span>Suggest change</span>
      </button>

      <div class="flex items-center gap-2">
        <button
          class="rounded-lg border border-border bg-canvas px-3 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated"
          @click="emit('cancel')"
        >
          Cancel
        </button>
        <button
          class="rounded-lg bg-terra px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-terra-hover disabled:opacity-40"
          :disabled="!body.trim()"
          @click="handleSubmit"
        >
          Add Pending Comment
        </button>
      </div>
    </div>
  </div>
</template>
