import {
  PLUGIN_TYPES_PATH,
  PLUGINS_PATH,
  type CreatePluginInstanceRequest,
  type PluginInstance,
  type PluginInstanceListResponse,
  type PluginInstanceResponse,
  type PluginTypeListResponse,
  type UpdatePluginInstanceRequest,
} from '@candy-mountain/shared'

export function usePluginTypes() {
  const request = useApi<PluginTypeListResponse>(PLUGIN_TYPES_PATH, { key: PLUGIN_TYPES_DATA_KEY })
  const types = computed(() => request.data.value?.types ?? [])
  return { ...request, types }
}

/** Instance mutations for the selected project; each one refreshes the instance list and the project registry. */
export function usePluginActions() {
  const { $api } = useNuxtApp()
  const { slug } = useSelectedProject()

  async function refreshPlugins() {
    await Promise.all([
      refreshNuxtData(pluginsDataKey(slug.value)),
      slug.value ? refreshProjectRegistry(slug.value) : undefined,
    ])
  }

  async function changed<T>(request: Promise<T>): Promise<T> {
    try {
      return await request
    }
    finally {
      await refreshPlugins()
    }
  }

  async function createPlugin(body: CreatePluginInstanceRequest): Promise<PluginInstance> {
    return (await changed($api<PluginInstanceResponse>(PLUGINS_PATH, { method: 'POST', body }))).instance
  }

  async function updatePlugin(id: string, body: UpdatePluginInstanceRequest): Promise<PluginInstance> {
    return (await changed($api<PluginInstanceResponse>(pluginInstancePath(id), { method: 'PATCH', body }))).instance
  }

  async function deletePlugin(id: string): Promise<void> {
    await changed($api(pluginInstancePath(id), { method: 'DELETE' }))
  }

  async function testPlugin(id: string): Promise<PluginInstance> {
    return (await changed($api<PluginInstanceResponse>(pluginInstancePath(id, 'test'), { method: 'POST' }))).instance
  }

  /** Calls a type's own action (GET|POST /plugins/:id/<action>); call refreshPlugins() after one that changes the instance. */
  function pluginAction<T>(id: string, action: string, options: { method?: 'GET' | 'POST', body?: Record<string, unknown>, query?: Record<string, string | number> } = {}): Promise<T> {
    return $api<T>(pluginInstancePath(id, action), { method: options.method ?? 'GET', body: options.body, query: options.query })
  }

  return { refreshPlugins, createPlugin, updatePlugin, deletePlugin, testPlugin, pluginAction }
}

/** The selected project's own instances and the platform-wide ones; admin only (the daemon refuses anyone else). */
export function usePlugins() {
  const { $api } = useNuxtApp()
  const { slug } = useSelectedProject()

  const request = useAsyncData(
    () => pluginsDataKey(slug.value),
    () => $api<PluginInstanceListResponse>(PLUGINS_PATH, { query: slug.value ? { project: slug.value } : undefined }),
  )

  const instances = computed(() => request.data.value?.instances ?? [])
  // Nuxt seeds a new key with the previous key's data, so another project's instances are filtered out by slug.
  const projectInstances = computed(() =>
    instances.value.filter(instance => instance.scope === 'project' && instance.projectSlug === slug.value),
  )
  const globalInstances = computed(() => instances.value.filter(instance => instance.scope === 'global'))

  return {
    instances: computed(() => [...projectInstances.value, ...globalInstances.value]),
    projectInstances,
    globalInstances,
    status: request.status,
    error: request.error,
    ...usePluginActions(),
  }
}
