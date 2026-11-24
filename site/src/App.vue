<script setup lang="ts">
import { onMounted } from 'vue'
import FeatureJourney from '@/components/FeatureJourney.vue'
import GetStartedSection from '@/components/GetStartedSection.vue'
import HeroSection from '@/components/HeroSection.vue'
import ReadingOrderDemo from '@/components/ReadingOrderDemo.vue'
import ShortcutsGrid from '@/components/ShortcutsGrid.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import SiteHeader from '@/components/SiteHeader.vue'

onMounted(() => {
  const sections = document.querySelectorAll('.reveal-section')
  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    !('IntersectionObserver' in window)
  ) {
    sections.forEach((el) => el.classList.add('is-visible'))
    return
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.02 },
  )

  sections.forEach((el) => observer.observe(el))
})
</script>

<template>
  <div class="min-h-screen bg-canvas text-ink">
    <SiteHeader />
    <main>
      <HeroSection />
      <div class="reveal-section">
        <ReadingOrderDemo />
      </div>
      <div class="reveal-section">
        <FeatureJourney />
      </div>
      <div class="reveal-section">
        <ShortcutsGrid />
      </div>
      <div class="reveal-section">
        <GetStartedSection />
      </div>
    </main>
    <SiteFooter />
  </div>
</template>
