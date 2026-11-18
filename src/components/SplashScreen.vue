<script setup lang="ts">
import { GitPullRequest, Loader2 } from '@lucide/vue'
</script>

<template>
  <div class="flex h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
    <div class="flex flex-col items-center gap-5">
      <div
        class="flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-500/30 bg-blue-500/15 shadow-lg shadow-blue-500/10"
      >
        <GitPullRequest class="h-8 w-8 text-blue-400" />
      </div>

      <div class="space-y-1.5">
        <h1 class="text-xl font-bold tracking-tight text-slate-100">PR Tour</h1>
        <p class="text-xs text-slate-400">Guided, dependency-aware code review</p>
      </div>

      <div class="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 class="h-3.5 w-3.5 animate-spin text-blue-400" />
        <span>Loading your review workspace…</span>
      </div>
    </div>
  </div>
</template>
