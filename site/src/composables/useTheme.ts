import { computed, onMounted, onUnmounted, ref } from 'vue'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'stroll-site-theme'
const preference = ref<ThemePreference>('system')
const systemDark = ref(false)
let mediaQuery: MediaQueryList | null = null

function applyTheme() {
  const isDark =
    preference.value === 'dark' ||
    (preference.value === 'system' && systemDark.value)
  document.documentElement.classList.toggle('dark', isDark)
}

function handleMediaChange(e: MediaQueryListEvent) {
  systemDark.value = e.matches
  applyTheme()
}

export function useTheme() {
  const isDark = computed(
    () =>
      preference.value === 'dark' ||
      (preference.value === 'system' && systemDark.value),
  )

  function setTheme(next: ThemePreference) {
    preference.value = next
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY)
      } else {
        localStorage.setItem(STORAGE_KEY, next)
      }
    } catch {
      // Ignore storage errors in restricted environments
    }
    applyTheme()
  }

  function toggleTheme() {
    setTheme(isDark.value ? 'light' : 'dark')
  }

  onMounted(() => {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mediaQuery.matches
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'light' || saved === 'dark') {
        preference.value = saved
      }
    } catch {
      // Ignore storage errors
    }
    applyTheme()
    mediaQuery.addEventListener('change', handleMediaChange)
  })

  onUnmounted(() => {
    mediaQuery?.removeEventListener('change', handleMediaChange)
  })

  return {
    preference,
    isDark,
    setTheme,
    toggleTheme,
  }
}
