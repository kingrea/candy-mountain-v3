import {
  MODULE_IDS,
  MODULES_PATH,
  PLUGIN_TYPES_PATH,
  PLUGINS_PATH,
  projectModulesPath,
  type ModuleId,
  type ModuleListResponse,
  type PluginInstanceListResponse,
  type PluginTypeListResponse,
  type ProjectModulesResponse,
  type SetProjectModulesRequest,
} from '@candy-mountain/shared'

/** Setup data for the selected project's Modules page; only the admin may call it, the daemon refuses others. */
export function useModulesSetup() {
  const { slug } = useSelectedProject()
  const { $api } = useNuxtApp()
  const toast = useToast()

  const definitions = useApi<ModuleListResponse>(MODULES_PATH, { key: 'modules-setup:definitions' })
  const enablement = useApi<ProjectModulesResponse>(() => projectModulesPath(slug.value ?? ''), {
    key: computed(() => `modules-setup:enabled:${slug.value ?? ''}`),
  })
  const pluginTypes = useApi<PluginTypeListResponse>(PLUGIN_TYPES_PATH, { key: 'modules-setup:plugin-types' })
  const instances = useApi<PluginInstanceListResponse>(PLUGINS_PATH, {
    key: computed(() => `modules-setup:instances:${slug.value ?? ''}`),
    query: { project: slug },
  })

  const requests = [definitions, enablement, pluginTypes, instances]
  const status = computed(() => {
    const statuses = requests.map(request => request.status.value)
    if (statuses.includes('error')) return 'error'
    if (statuses.every(value => value === 'success')) return 'success'
    return 'pending'
  })
  const error = computed(() => requests.find(request => request.error.value)?.error.value ?? null)

  const enabled = computed(() => enablement.data.value?.modules ?? [])
  const saving = ref<ModuleId | null>(null)

  async function setEnabled(id: ModuleId, on: boolean) {
    if (!slug.value || saving.value) return
    const label = definitions.data.value?.modules.find(mod => mod.id === id)?.label ?? id
    saving.value = id
    try {
      const body: SetProjectModulesRequest = { modules: toggledModules(MODULE_IDS, enabled.value, id, on) }
      enablement.data.value = await $api<ProjectModulesResponse>(projectModulesPath(slug.value), { method: 'PUT', body })
      await refreshProjectRegistry(slug.value)
      toast.add({ title: `${label} ${on ? 'enabled' : 'disabled'}`, color: 'success' })
    }
    catch (e) {
      toast.add({ title: `Couldn't ${on ? 'enable' : 'disable'} ${label}`, description: toApiError(e).message, color: 'error' })
    }
    finally {
      saving.value = null
    }
  }

  return {
    modules: computed(() => definitions.data.value?.modules ?? []),
    enabled,
    pluginTypes: computed(() => pluginTypes.data.value?.types ?? []),
    instances: computed(() => instances.data.value?.instances ?? []),
    status,
    error,
    saving,
    setEnabled,
    refresh: () => Promise.all(requests.map(request => request.refresh())),
  }
}
