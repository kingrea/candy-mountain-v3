import type { WorkspaceListResponse } from '@crab-shack/platform-sdk'
import { coloredFavicon, DEFAULT_FAVICON, projectFaviconColor } from '../utils/favicon'

export default defineNuxtPlugin(() => {
  const route = useRoute()
  // Share the shell's directory without fetching authenticated data on the login page.
  const { data } = useNuxtData<WorkspaceListResponse>(PROJECT_DIRECTORY_KEYS[0]!)
  const color = computed(() => projectFaviconColor(route.params[PROJECT_ROUTE_PARAM], data.value?.workspaces ?? []))
  const href = ref(DEFAULT_FAVICON)

  useHead(() => ({
    link: [{ key: 'candy-mountain-favicon', rel: 'icon', type: 'image/png', sizes: '64x64', href: href.value }],
  }))

  watch(color, async (value, _, onCleanup) => {
    let active = true
    onCleanup(() => { active = false })
    href.value = DEFAULT_FAVICON
    if (!value) return
    try {
      const icon = await coloredFavicon(value)
      if (active) href.value = icon
    }
    catch {
      // Keep the static icon if the image or browser canvas is unavailable.
    }
  }, { immediate: true })
})
