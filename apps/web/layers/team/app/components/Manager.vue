<script setup lang="ts">
import { projectTeamPath, type TeamMember } from '@candy-mountain/shared'
import type { TableColumn } from '@nuxt/ui'
import ProjectsConfirmModal from '~/components/projects/ProjectsConfirmModal.vue'

/** `null` opens the editor for a new member, `undefined` closes it. */
const editing = defineModel<TeamMember | null | undefined>('editing')

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const toast = useToast()
const confirm = useOverlay().create(ProjectsConfirmModal)

const { members, bots, status, error: loadError, refresh } = useTeam()
const actionError = ref<ApiErrorInfo | null>(null)

const editorOpen = computed({
  get: () => editing.value !== undefined,
  set: (open) => {
    if (!open) editing.value = undefined
  },
})
// Kept while the editor closes so its title does not flip to "Add" mid-animation.
const editorMember = ref<TeamMember | null>(null)
watch(editing, (member) => {
  if (member !== undefined) editorMember.value = member
})

const columns: TableColumn<TeamMember>[] = [
  { accessorKey: 'displayName', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'slackMemberId', header: 'Slack member id' },
  { id: 'bots', header: 'Bots' },
  { accessorKey: 'lastActiveAt', header: 'Last active' },
  { id: 'actions', header: '' },
]

function formatActive(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Never'
}

async function onSaved(member: TeamMember, created: boolean) {
  actionError.value = null
  await refresh()
  toast.add({ title: created ? `Added ${member.displayName}` : `Saved ${member.displayName}`, color: 'success' })
}

async function remove(member: TeamMember) {
  const confirmed = await confirm.open({
    title: `Remove ${member.displayName}?`,
    description: 'They can no longer talk to any of the project\'s bots.',
    confirmLabel: 'Remove member',
  }).result
  if (!confirmed || !slug.value) return
  actionError.value = null
  try {
    await $api(`${projectTeamPath(slug.value)}/${member.id}`, { method: 'DELETE' })
    toast.add({ title: `Removed ${member.displayName}`, color: 'success' })
  }
  catch (error) {
    actionError.value = toApiError(error)
  }
  await refresh()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert
      v-if="actionError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="actionError.message"
      :description="actionError.code"
      :close="{ onClick: () => { actionError = null } }"
      data-testid="action-error"
    />
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not load the team"
      :description="toApiError(loadError).message"
    />

    <UTable
      v-if="members.length"
      :data="members"
      :columns="columns"
      data-testid="team-table"
    >
      <template #email-cell="{ row }">
        <span v-if="row.original.email">{{ row.original.email }}</span>
        <span v-else class="text-muted">None</span>
      </template>
      <template #slackMemberId-cell="{ row }">
        <span class="font-mono">{{ row.original.slackMemberId }}</span>
      </template>
      <template #bots-cell="{ row }">
        <div class="flex flex-wrap gap-1" data-testid="member-bots-cell">
          <UBadge
            v-for="label in teamScopeLabels(row.original.botScope, bots)"
            :key="label"
            :label="label"
            color="neutral"
            variant="subtle"
          />
          <span v-if="!teamScopeLabels(row.original.botScope, bots).length" class="text-muted">None</span>
        </div>
      </template>
      <template #lastActiveAt-cell="{ row }">
        <span class="text-muted">{{ formatActive(row.original.lastActiveAt) }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end gap-1">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            :aria-label="`Edit ${row.original.displayName}`"
            data-testid="edit-member"
            @click="editing = row.original"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            :aria-label="`Remove ${row.original.displayName}`"
            data-testid="remove-member"
            @click="remove(row.original)"
          />
        </div>
      </template>
    </UTable>
    <USkeleton v-else-if="status === 'pending'" class="h-40 w-full" />
    <UEmpty
      v-else-if="!loadError"
      icon="i-lucide-users"
      title="No team members yet"
      description="Add the people who may talk to this project's bots in Slack."
      :actions="[{ label: 'Add member', icon: 'i-lucide-plus', onClick: () => { editing = null } }]"
    />

    <TeamEditorModal
      v-model:open="editorOpen"
      :member="editorMember"
      :bots="bots"
      @saved="onSaved"
    />
  </div>
</template>
