export default defineNuxtPlugin((nuxtApp) => {
  // $api is read per call: core's api plugin may run after this one.
  const api: RepositoryApi = <T>(path: string, options: { method: 'POST' | 'PUT', body?: Record<string, unknown> }) => nuxtApp.$api<T>(path, options)
  registerPluginPanel('repository', defineAsyncComponent(() => import('#layers/repository/app/components/Panel.vue')))
  registerPluginIcon('repository', { name: 'i-lucide-git-branch' })
  registerProjectHomeCard('facts', { id: 'repository', component: defineAsyncComponent(() => import('#layers/repository/app/components/Facts.vue')) })
  registerProjectFormField(repositoryFormField(defineAsyncComponent(() => import('#layers/repository/app/components/FormPath.vue')), api))
  registerProjectRowItem('detail', { id: 'repository', component: defineAsyncComponent(() => import('#layers/repository/app/components/RowPath.vue')) })
  registerProjectRowItem('badges', { id: 'repository', component: defineAsyncComponent(() => import('#layers/repository/app/components/RowFacts.vue')) })
  registerProjectRowAction(repositoryRecheckAction(api))
})
