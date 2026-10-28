<script setup lang="ts">
import type { CreateIssueResponse } from '@candy-mountain/shared'
import type { IssuesAgentCreateOption } from '#layers/issues/app/utils/issue-create'

const { slug } = useSelectedProject()
const { registry } = useProjectRegistry()
const createWithAgent = useIssuesCreateWithAgent()
const toast = useToast()

const open = ref(false)
const step = ref<'choose' | 'write'>('choose')
const canWrite = computed(() => issuesCanWrite(registry.value))

watch(open, (isOpen) => {
  if (isOpen) step.value = 'choose'
})

function onAgent(option: IssuesAgentCreateOption) {
  open.value = false
  createWithAgent.start(option)
}

async function onCreated({ issue, warnings }: CreateIssueResponse) {
  open.value = false
  for (const warning of warnings) {
    toast.add({ title: 'Dependency not added', description: warning, icon: 'i-lucide-triangle-alert', color: 'warning' })
  }
  toast.add({ title: `Created ${issue.id}`, description: issue.title, icon: 'i-lucide-circle-check', color: 'success' })
  if (slug.value) await navigateTo(issuesPagePath(slug.value, issue.id))
}
</script>

<template>
  <template v-if="canWrite && slug">
    <UButton icon="i-lucide-plus" label="Add issue" data-testid="issue-add" @click="open = true" />

    <UModal
      v-model:open="open"
      :title="step === 'choose' ? 'Add issue' : 'New issue'"
      :description="step === 'choose' ? 'Draft it with an agent or write it yourself.' : 'Created in the project\'s issue tracker.'"
      :ui="{ content: step === 'write' ? 'sm:max-w-2xl' : undefined }"
    >
      <template #body>
        <IssuesAddChooser
          v-if="step === 'choose'"
          :agent-options="createWithAgent.options.value"
          @agent="onAgent"
          @write="step = 'write'"
        />
        <IssuesCreateForm v-else :slug="slug" @created="onCreated" @back="step = 'choose'" />
      </template>
    </UModal>
  </template>
</template>
