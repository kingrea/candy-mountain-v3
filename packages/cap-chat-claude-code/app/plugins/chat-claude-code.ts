export default defineNuxtPlugin(() => {
  chatFamilyRegister('claude-code', {
    id: 'chat-claude-code',
    promptBar: defineAsyncComponent(() => import('#layers/chat-claude-code/app/components/ModelEffort.vue')),
  })
})
