<script setup lang="ts">
import { projectEnvironmentPath, type Environment } from '@candy-mountain/shared'
import ProjectsConfirmModal from '~/components/projects/ProjectsConfirmModal.vue'

defineProps<{
  canManage: boolean
}>()

/** `null` opens the editor for a new environment, `undefined` closes it. */
const editing = defineModel<Environment | null | undefined>('editing')

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const toast = useToast()
const confirm = useOverlay().create(ProjectsConfirmModal)

const { sources } = useDeploymentsSources()
const { environments, status, error: loadError, refresh } = useDeploymentsEnvironments()
const live = useDeploymentsLiveVersions()

const actionError = ref<ApiErrorInfo | null>(null)

const editorOpen = computed({
  get: () => editing.value !== undefined,
  set: (open) => {
    if (!open) editing.value = undefined
  },
})
// Kept while the editor closes so its title does not flip to "New environment" mid-animation.
const editorEnvironment = ref<Environment | null>(null)
watch(editing, (environment) => {
  if (environment !== undefined) editorEnvironment.value = environment
})

const liveFailed = computed(() => live.status.value === 'error')
const refreshing = ref(false)

async function refreshLive() {
  refreshing.value = true
  try {
    await live.refresh()
  }
  finally {
    refreshing.value = false
  }
}
const liveState = (environment: Environment) => deploymentsLiveState(live.byEnvironment.value.get(environment.id), liveFailed.value)

async function afterChange() {
  await refresh()
  await live.refresh()
}

async function onSaved(environment: Environment, created: boolean) {
  actionError.value = null
  toast.add({ title: created ? `Added ${environment.name}` : `Saved ${environment.name}`, color: 'success' })
  await afterChange()
}

async function remove(environment: Environment) {
  const confirmed = await confirm.open({
    title: `Delete ${environment.name}?`,
    description: 'The environment and its live-version settings are removed. Nothing changes at the vendor.',
    confirmLabel: 'Delete environment',
  }).result
  if (!confirmed || !slug.value) return
  actionError.value = null
  try {
    await $api(projectEnvironmentPath(slug.value, environment.id), { method: 'DELETE' })
    toast.add({ title: `Deleted ${environment.name}`, color: 'success' })
  }
  catch (error) {
    actionError.value = toApiError(error)
  }
  await afterChange()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <DeploymentsDeployZone />

    <section class="flex flex-col gap-4" aria-labelledby="environments-title">
      <div class="flex items-center justify-between gap-2">
        <h2 id="environments-title" class="text-sm font-semibold text-highlighted">
          Environments
        </h2>
        <UButton
          v-if="environments.length"
          label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="refreshing"
          data-testid="live-refresh"
          @click="refreshLive"
        />
      </div>

      <UAlert
        v-if="actionError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="actionError.message"
        :close="{ onClick: () => { actionError = null } }"
        data-testid="action-error"
      />
      <UAlert
        v-if="loadError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Could not load environments"
        :description="toApiError(loadError).message"
      />

      <div v-if="status === 'pending' && !environments.length" class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <USkeleton v-for="n in 2" :key="n" class="h-56 w-full" />
      </div>
      <div v-else-if="environments.length" class="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="environment-cards">
        <DeploymentsEnvironmentCard
          v-for="environment in environments"
          :key="environment.id"
          :environment="environment"
          :source-label="deploymentsSourceLabel(sources, environment.liveSourceKind)"
          :live="liveState(environment)"
          :can-manage="canManage"
          @edit="editing = $event"
          @delete="remove"
        />
      </div>
      <UEmpty
        v-else-if="!loadError"
        icon="i-lucide-rocket"
        title="No environments yet"
        :description="canManage ? 'Add an environment to see what is live in it.' : 'An admin can add the project\'s environments here.'"
        :actions="canManage ? [{ label: 'New environment', icon: 'i-lucide-plus', onClick: () => { editing = null } }] : []"
      />
    </section>

    <DeploymentsEditorModal
      v-if="canManage"
      v-model:open="editorOpen"
      :environment="editorEnvironment"
      :sources="sources"
      @saved="onSaved"
    />
  </div>
</template>
