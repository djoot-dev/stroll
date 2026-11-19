<script setup lang="ts">
</script>

<template>
  <div class="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-canvas px-6 text-center">
    <!-- Soft organic sage & terracotta ambient halo echoing the Stroll logo -->
    <div
      class="pointer-events-none absolute h-80 w-80 rounded-full bg-sage-soft/80 blur-3xl"
    />
    <div
      class="pointer-events-none absolute translate-x-12 translate-y-8 h-48 w-48 rounded-full bg-terra-soft blur-3xl"
    />

    <div class="animate-pop-in relative flex flex-col items-center gap-5">
      <div class="relative">
        <img
          src="/logo.svg"
          alt="Stroll"
          class="stroll-elevated h-20 w-20 rounded-[22px]"
        />
      </div>

      <div class="space-y-1.5">
        <h1 class="text-2xl font-bold tracking-tight text-ink">Stroll</h1>
        <p class="text-xs text-ink-muted">Guided, dependency-aware code review</p>
      </div>

      <div class="mt-2 w-48 space-y-2">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-canvas-elevated">
          <div class="animate-shimmer h-full w-2/5 rounded-full bg-terra" />
        </div>
        <p class="text-[11px] text-ink-faint">Preparing your review trail…</p>
      </div>
    </div>
  </div>
</template>
