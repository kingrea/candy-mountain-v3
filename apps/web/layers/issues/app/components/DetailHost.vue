<script setup lang="ts">
import type { IssueDetail } from '@candy-mountain/shared'

defineProps<{
  slug: string
  issueId: string
  onOpenIssue?: (id: string) => void
}>()

const emit = defineEmits<{ loaded: [issue: IssueDetail] }>()

const slots = defineSlots<{
  run?: (props: { issue: IssueDetail }) => unknown
}>()
</script>

<template>
  <IssuesDetail
    :slug="slug"
    :issue-id="issueId"
    :on-open-issue="onOpenIssue"
    @loaded="emit('loaded', $event)"
  >
    <template v-if="slots.run" #run="scope">
      <slot name="run" v-bind="scope" />
    </template>
    <template #comments>
      <IssuesComments :slug="slug" :issue-id="issueId" />
    </template>
  </IssuesDetail>
</template>
