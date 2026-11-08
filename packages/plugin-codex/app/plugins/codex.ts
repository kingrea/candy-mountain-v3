import codexIcon from '#layers/codex/app/assets/icons/codex.svg?url'

export default defineNuxtPlugin(() => {
  registerPluginIcon('codex', { src: codexIcon, class: 'dark:invert' })
  registerPluginPanel('codex', defineAsyncComponent(() => import('#layers/codex/app/components/Panel.vue')))
})
