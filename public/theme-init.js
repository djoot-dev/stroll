;(function () {
  try {
    var raw = localStorage.getItem('stroll_app_settings')
    var parsed = raw ? JSON.parse(raw) : null
    var mode = parsed && parsed.theme ? parsed.theme : 'light'
    var isDark =
      mode === 'dark' ||
      (mode === 'system' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    if (
      parsed &&
      (parsed.diffColorPalette === 'blue-amber' || parsed.diffColorPalette === 'teal-magenta')
    ) {
      document.documentElement.classList.add('diff-palette-' + parsed.diffColorPalette)
    }
  } catch (e) {}
})()
