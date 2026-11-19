<script setup lang="ts">
</script>

<template>
  <div class="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-canvas px-6 text-center">
    <!-- Subtle ambient glow -->
    <div
      class="pointer-events-none absolute h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl"
    />

    <div class="animate-pop-in relative flex flex-col items-center gap-5">
      <img
        src="/logo.svg"
        alt="Stroll"
        class="h-16 w-16 rounded-2xl shadow-lg shadow-black/40"
      />

      <div class="space-y-1.5">
        <h1 class="text-xl font-bold tracking-tight text-slate-100">Stroll</h1>
        <p class="text-xs text-slate-400">Guided, dependency-aware code review</p>
      </div>

      <div class="mt-2 w-44 space-y-2">
        <div class="h-1 w-full overflow-hidden rounded-full bg-canvas-subtle">
          <div class="animate-shimmer h-full w-2/5 rounded-full bg-blue-500/80" />
        </div>
        <p class="text-[11px] text-slate-500">Loading your review workspace…</p>
      </div>
    </div>
  </div>
</template>
