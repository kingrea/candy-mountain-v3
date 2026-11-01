import codexIcon from '#layers/chat-codex/app/assets/icons/codex.svg?url'

export default defineNuxtPlugin(() => {
  registerPluginIcon('codex', { src: codexIcon, class: 'dark:invert' })
  registerPluginPanel('codex', defineAsyncComponent(() => import('#layers/chat-codex/app/components/Panel.vue')))
  chatFamilyRegister('codex', {
    id: 'chat-codex',
    promptBar: defineAsyncComponent(() => import('#layers/chat-codex/app/components/ModelEffort.vue')),
  })
})
