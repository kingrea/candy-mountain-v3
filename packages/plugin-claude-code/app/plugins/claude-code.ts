import claudeCodeIcon from '#layers/claude-code/app/assets/icons/claude-code.svg?url'

export default defineNuxtPlugin(() => {
  registerPluginIcon('claude-code', { src: claudeCodeIcon })
  registerPluginPanel('claude-code', defineAsyncComponent(() => import('#layers/claude-code/app/components/Panel.vue')))
  registerPluginForm('claude-code', defineAsyncComponent(() => import('#layers/claude-code/app/components/Form.vue')))
})
