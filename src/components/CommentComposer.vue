<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
}>()

const emit = defineEmits<{
  (e: 'submit', body: string): void
  (e: 'cancel'): void
}>()

const body = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

onMounted(() => {
  textareaRef.value?.focus()
})

function handleSubmit() {
  if (!body.value.trim()) return
  emit('submit', body.value.trim())
  body.value = ''
}
</script>

<template>
  <div class="stroll-card my-2 mx-3 rounded-xl border border-terra-border bg-canvas-subtle p-3">
    <div class="mb-2 flex items-center justify-between text-[11px] text-ink-muted">
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
      <span class="text-ink-faint">Saved locally until Finish Review</span>
    </div>

    <textarea
      ref="textareaRef"
      v-model="body"
      rows="3"
      placeholder="Write a review comment (Markdown supported)..."
      class="w-full rounded-lg border border-border bg-canvas-inset px-3 py-2 font-sans text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
      @keydown.meta.enter.prevent="handleSubmit"
      @keydown.ctrl.enter.prevent="handleSubmit"
      @keydown.esc.prevent="emit('cancel')"
    />

    <div class="mt-2 flex items-center justify-end gap-2">
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
</template>
