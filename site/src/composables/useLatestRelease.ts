import { computed, onMounted, ref } from 'vue'

export type PlatformId = 'macos' | 'windows' | 'linux'

export interface ReleaseAssetLink {
  label: string
  url: string
  filename?: string
}

export interface PlatformDownload {
  id: PlatformId
  name: string
  subtitle: string
  primary: ReleaseAssetLink
  secondary?: ReleaseAssetLink
}

interface GitHubAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  assets: GitHubAsset[]
}

const RELEASES_PAGE = 'https://github.com/djoot-dev/stroll/releases/latest'
const RELEASES_API = 'https://api.github.com/repos/djoot-dev/stroll/releases/latest'

function detectPlatform(): PlatformId {
  if (typeof navigator === 'undefined') return 'macos'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('linux') && !ua.includes('android')) return 'linux'
  return 'mac' in navigator || ua.includes('mac') ? 'macos' : 'macos'
}

export function useLatestRelease() {
  const detectedPlatform = ref<PlatformId>(detectPlatform())
  const latestVersion = ref<string | null>(null)
  const releaseUrl = ref<string>(RELEASES_PAGE)
  const assets = ref<GitHubAsset[]>([])

  function findAsset(predicate: (name: string) => boolean): GitHubAsset | undefined {
    return assets.value.find((a) => predicate(a.name.toLowerCase()))
  }

  const platforms = computed<PlatformDownload[]>(() => {
    const dmg = findAsset((n) => n.endsWith('.dmg'))
    const exe = findAsset((n) => n.endsWith('.exe'))
    const msi = findAsset((n) => n.endsWith('.msi'))
    const appImage = findAsset((n) => n.endsWith('.appimage'))
    const deb = findAsset((n) => n.endsWith('.deb'))

    return [
      {
        id: 'macos',
        name: 'macOS',
        subtitle: 'Apple Silicon (aarch64)',
        primary: {
          label: 'Download .dmg',
          url: dmg?.browser_download_url ?? RELEASES_PAGE,
          filename: dmg?.name,
        },
      },
      {
        id: 'windows',
        name: 'Windows',
        subtitle: 'Windows 10 & 11 (x64)',
        primary: {
          label: 'Download .exe',
          url: exe?.browser_download_url ?? msi?.browser_download_url ?? RELEASES_PAGE,
          filename: exe?.name ?? msi?.name,
        },
        secondary: msi && exe
          ? {
              label: '.msi installer',
              url: msi.browser_download_url,
              filename: msi.name,
            }
          : undefined,
      },
      {
        id: 'linux',
        name: 'Linux',
        subtitle: 'AppImage & Debian / Ubuntu',
        primary: {
          label: 'Download .AppImage',
          url: appImage?.browser_download_url ?? deb?.browser_download_url ?? RELEASES_PAGE,
          filename: appImage?.name ?? deb?.name,
        },
        secondary: deb && appImage
          ? {
              label: '.deb package',
              url: deb.browser_download_url,
              filename: deb.name,
            }
          : undefined,
      },
    ]
  })

  const activePlatform = computed(
    () => platforms.value.find((p) => p.id === detectedPlatform.value) ?? platforms.value[0],
  )

  onMounted(async () => {
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) return
      const data = (await res.json()) as GitHubRelease
      if (data.tag_name) latestVersion.value = data.tag_name
      if (data.html_url) releaseUrl.value = data.html_url
      if (Array.isArray(data.assets)) assets.value = data.assets
    } catch {
      // Fallback to static releases/latest URL
    }
  })

  return {
    detectedPlatform,
    latestVersion,
    releaseUrl,
    platforms,
    activePlatform,
  }
}
