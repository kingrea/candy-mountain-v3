import claudeCodeIcon from '#layers/chat-claude-code/app/assets/icons/claude-code.svg?url'

export default defineNuxtPlugin(() => {
  registerPluginIcon('claude-code', { src: claudeCodeIcon })
  registerPluginPanel('claude-code', defineAsyncComponent(() => import('#layers/chat-claude-code/app/components/Panel.vue')))
  registerPluginForm('claude-code', defineAsyncComponent(() => import('#layers/chat-claude-code/app/components/Form.vue')))
  chatFamilyRegister('claude-code', {
    id: 'chat-claude-code',
    promptBar: defineAsyncComponent(() => import('#layers/chat-claude-code/app/components/ModelEffort.vue')),
  })
})
