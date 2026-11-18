<script setup lang="ts">
import { CheckCircle2, KeyRound, Loader2, LogOut, X } from '@lucide/vue'
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const tokenInput = ref(auth.pat)

watch(
  () => auth.showSettingsModal,
  (open) => {
    if (open) tokenInput.value = auth.pat
  },
)

async function handleSave() {
  if (!tokenInput.value.trim()) return
  const ok = await auth.verifyAndLoadProfile(tokenInput.value.trim())
  if (ok) {
    auth.showSettingsModal = false
  }
}
</script>

<template>
  <div
    v-if="auth.showSettingsModal"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    @click.self="auth.showSettingsModal = false"
  >
    <div class="w-full max-w-md rounded-xl border border-border bg-canvas-subtle shadow-2xl">
      <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div class="flex items-center gap-2">
          <KeyRound class="h-4 w-4 text-blue-400" />
          <h2 class="text-sm font-semibold text-slate-100">GitHub Authentication</h2>
        </div>
        <button
          class="rounded p-1 text-slate-400 hover:bg-canvas-elevated hover:text-slate-100"
          @click="auth.showSettingsModal = false"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="space-y-4 p-5">
        <p class="text-xs leading-relaxed text-slate-400">
          Enter a GitHub Personal Access Token (PAT) with <code class="text-slate-200">repo</code>
          and <code class="text-slate-200">read:user</code> scopes. Stored securely on your machine
          via Tauri Store.
        </p>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-300">Personal Access Token</label>
          <input
            v-model="tokenInput"
            type="password"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            class="w-full rounded-lg border border-border bg-canvas-inset px-3 py-2 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
            @keydown.enter="handleSave"
          />
        </div>

        <div
          v-if="auth.error"
          class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
        >
          {{ auth.error }}
        </div>

        <div
          v-if="auth.viewer"
          class="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
        >
          <span class="flex items-center gap-2">
            <CheckCircle2 class="h-4 w-4" />
            Signed in as <strong class="font-mono">@{{ auth.viewer.login }}</strong>
          </span>
          <button
            class="inline-flex items-center gap-1 text-slate-400 hover:text-rose-300"
            @click="auth.clearPat()"
          >
            <LogOut class="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button
          class="rounded-lg border border-border bg-canvas px-3.5 py-1.5 text-xs text-slate-300 hover:bg-canvas-elevated"
          @click="auth.showSettingsModal = false"
        >
          Cancel
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
          :disabled="auth.isLoading || !tokenInput.trim()"
          @click="handleSave"
        >
          <Loader2 v-if="auth.isLoading" class="h-3.5 w-3.5 animate-spin" />
          <span>Verify & Save</span>
        </button>
      </div>
    </div>
  </div>
</template>
