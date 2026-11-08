export default defineNuxtPlugin(() => {
  chatFamilyRegister('codex', {
    id: 'chat-codex',
    promptBar: defineAsyncComponent(() => import('#layers/chat-codex/app/components/ModelEffort.vue')),
  })
})
