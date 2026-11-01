export default defineNuxtPlugin(() => {
  registerPluginPanel('repository', defineAsyncComponent(() => import('#layers/repository/app/components/Panel.vue')))
  registerPluginIcon('repository', { name: 'i-lucide-git-branch' })
  registerProjectHomeCard('facts', { id: 'repository', component: defineAsyncComponent(() => import('#layers/repository/app/components/Facts.vue')) })
})
