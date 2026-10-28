<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import type { IssuesRunAgent } from '#layers/issues/app/utils/issues-run'
import type { IssuesRunStarted } from '#layers/issues/app/composables/useIssuesRun'

const props = withDefaults(defineProps<{
  slug: string
  ids: readonly string[]
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  testid?: string
}>(), { size: 'md', variant: 'outline', testid: 'issue-run' })

const emit = defineEmits<{ started: [run: IssuesRunStarted] }>()

const { availability, starting, run } = useIssuesRun(() => props.slug)
const chooserOpen = ref(false)

const description = computed(() => props.ids.length === 1
  ? `The agent works on ${props.ids[0]} in the project's checkout.`
  : `The agent works on ${props.ids.length} issues in the project's checkout.`)

async function start(agent: IssuesRunAgent) {
  chooserOpen.value = false
  const started = await run(props.ids, agent)
  if (started) emit('started', started)
}

function onClick() {
  const [only, ...others] = availability.value.agents
  if (!only) return
  if (others.length === 0) void start(only)
  else chooserOpen.value = true
}
</script>

<template>
  <UTooltip :disabled="availability.enabled" :ui="{ content: 'h-auto max-w-80' }">
    <span
      :tabindex="availability.enabled ? undefined : 0"
      class="inline-flex shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-primary"
      :data-testid="`${testid}-wrap`"
    >
      <UButton
        label="Run"
        icon="i-lucide-play"
        color="neutral"
        :size="size"
        :variant="variant"
        :disabled="!availability.enabled || ids.length === 0"
        :loading="starting"
        :data-testid="testid"
        @click="onClick"
      />
    </span>
    <template #content>
      <ul class="flex flex-col gap-1 py-0.5 text-xs whitespace-normal" :data-testid="`${testid}-reasons`">
        <li v-for="line in availability.missing" :key="line">
          {{ line }}
        </li>
      </ul>
    </template>
  </UTooltip>

  <UModal v-model:open="chooserOpen" title="Run with which agent?" :description="description" :ui="{ content: 'sm:max-w-sm' }">
    <template #body>
      <div class="flex flex-col gap-2" :data-testid="`${testid}-chooser`">
        <UButton
          v-for="agent in availability.agents"
          :key="agent.agentId"
          color="neutral"
          variant="outline"
          size="lg"
          block
          :icon="agent.icon"
          :label="`Run with ${agent.name}`"
          class="justify-start"
          :data-testid="`${testid}-${agent.agentId}`"
          @click="start(agent)"
        />
      </div>
    </template>
  </UModal>
</template>
