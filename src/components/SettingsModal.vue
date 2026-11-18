<script setup lang="ts">
import { CheckCircle2, FolderGit2, KeyRound, Loader2, LogOut, Plus, Terminal, Trash2, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { isTauriRuntime } from '@/services/native'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'

const auth = useAuthStore()
const review = useReviewStore()
const tokenInput = ref(auth.pat)
const repoInput = ref('')
const pathInput = ref('')

const linkedRepos = computed(() => Object.entries(review.repoPaths))
const activePRRepo = computed(() =>
  review.pr ? `${review.pr.owner}/${review.pr.repo}` : '',
)

watch(
  () => auth.showSettingsModal,
  (open) => {
    if (open) {
      tokenInput.value = auth.pat
      if (!repoInput.value && activePRRepo.value) {
        repoInput.value = activePRRepo.value
        pathInput.value = review.repoPaths[activePRRepo.value] ?? ''
      }
    }
  },
)

async function handleSave() {
  if (!tokenInput.value.trim()) return
  const ok = await auth.verifyAndLoadProfile(tokenInput.value.trim())
  if (ok) {
    auth.showSettingsModal = false
  }
}

async function handleSignInWithGh() {
  const ok = await auth.signInWithGh()
  if (ok) {
    tokenInput.value = auth.pat
    auth.showSettingsModal = false
  }
}

async function handleLinkRepo() {
  if (!repoInput.value.trim() || !pathInput.value.trim()) return
  await review.linkRepoPath(repoInput.value, pathInput.value)
  repoInput.value = ''
  pathInput.value = ''
}
</script>

<template>
  <Transition name="modal-pop">
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
          Sign in with your local <code class="text-slate-200">gh</code> CLI session or enter a
          GitHub Personal Access Token (PAT) with <code class="text-slate-200">repo</code> and
          <code class="text-slate-200">read:user</code> scopes.
        </p>

        <div v-if="isTauriRuntime()">
          <button
            class="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
            :disabled="auth.isLoading"
            @click="handleSignInWithGh"
          >
            <Loader2 v-if="auth.isLoading" class="h-3.5 w-3.5 animate-spin" />
            <Terminal v-else class="h-3.5 w-3.5" />
            <span>Use GitHub CLI (gh auth token)</span>
          </button>
          <div class="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
            <span class="h-px flex-1 bg-border-muted" />
            <span>or paste PAT</span>
            <span class="h-px flex-1 bg-border-muted" />
          </div>
        </div>

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

        <!-- Local Repository Checkouts -->
        <div class="border-t border-border pt-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <FolderGit2 class="h-4 w-4 text-purple-400" />
              <h3 class="text-xs font-semibold text-slate-200">Local Repository Checkouts</h3>
            </div>
            <span
              v-if="!isTauriRuntime()"
              class="rounded border border-slate-700 bg-canvas px-1.5 py-0.5 text-[10px] text-slate-400"
            >
              Desktop-only AST &amp; Blame
            </span>
          </div>
          <p class="mt-1 text-[11px] leading-relaxed text-slate-400">
            Map <code class="text-slate-300">owner/repo</code> to a local git checkout for
            unchanged-file symbol resolution and <code class="text-slate-300">git blame</code> on hover.
          </p>

          <div v-if="linkedRepos.length > 0" class="mt-2.5 max-h-28 space-y-1.5 overflow-y-auto">
            <div
              v-for="[ownerRepo, localPath] in linkedRepos"
              :key="ownerRepo"
              class="flex items-center justify-between gap-2 rounded-lg border border-border-muted bg-canvas px-2.5 py-1.5 text-[11px]"
            >
              <div class="min-w-0">
                <div class="font-mono font-semibold text-slate-200">{{ ownerRepo }}</div>
                <div class="truncate font-mono text-[10px] text-slate-400">{{ localPath }}</div>
              </div>
              <button
                class="shrink-0 rounded p-1 text-slate-500 hover:bg-canvas-elevated hover:text-rose-400"
                title="Unlink repository"
                @click="review.unlinkRepoPath(ownerRepo)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div class="mt-2.5 space-y-2">
            <div class="flex gap-2">
              <input
                v-model="repoInput"
                type="text"
                placeholder="owner/repo"
                class="w-40 rounded-lg border border-border bg-canvas-inset px-2.5 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
              />
              <input
                v-model="pathInput"
                type="text"
                placeholder="/path/to/local/checkout"
                class="flex-1 rounded-lg border border-border bg-canvas-inset px-2.5 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                @keydown.enter="handleLinkRepo"
              />
            </div>
            <div class="flex items-center justify-between">
              <button
                v-if="activePRRepo"
                class="text-[11px] text-blue-400 hover:text-blue-300"
                @click="repoInput = activePRRepo"
              >
                Use current PR ({{ activePRRepo }})
              </button>
              <span v-else />
              <button
                class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-canvas-elevated disabled:opacity-40"
                :disabled="!repoInput.trim() || !pathInput.trim()"
                @click="handleLinkRepo"
              >
                <Plus class="h-3.5 w-3.5" />
                <span>Link Checkout</span>
              </button>
            </div>
          </div>
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
  </Transition>
</template>
