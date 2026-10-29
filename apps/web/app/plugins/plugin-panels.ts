export default defineNuxtPlugin(() => {
  registerPluginPanel('repository', defineAsyncComponent(() => import('~/components/plugins/panels/RepositoryPanel.vue')))
  registerPluginPanel('claude-code', defineAsyncComponent(() => import('~/components/plugins/panels/ClaudeCodePanel.vue')))
  registerPluginPanel('codex', defineAsyncComponent(() => import('~/components/plugins/panels/CodexPanel.vue')))
  registerPluginForm('claude-code', defineAsyncComponent(() => import('~/components/plugins/forms/ClaudeCodeForm.vue')))
})
