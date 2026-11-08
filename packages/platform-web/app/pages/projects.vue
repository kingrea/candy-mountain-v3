<script setup lang="ts">
import { WORKSPACES_PATH, type Workspace } from '@candy-mountain/platform-sdk'
import ProjectsConfirmModal from '#layers/platform-web/app/components/projects/ProjectsConfirmModal.vue'
import type { ProjectGroup } from '#layers/platform-web/app/components/projects/ProjectsList.vue'

definePageMeta({ layout: 'dashboard' })
useHead({ title: SCOPE.pluralTitle })

const { $api } = useNuxtApp()
const toast = useToast()
const confirm = useOverlay().create(ProjectsConfirmModal)
const newLabel = `New ${SCOPE.singular}`

const { projects, status, error: loadError } = useProjects({ includeArchived: true })
const { organisations } = useOrganisations()

const showArchived = ref(false)
const archivedCount = computed(() => projects.value.filter(project => project.archived).length)
const visibleProjects = computed(() =>
  showArchived.value ? projects.value : projects.value.filter(project => !project.archived),
)

const groups = computed<ProjectGroup[]>(() => {
  const known = new Set(organisations.value.map(organisation => organisation.id))
  const grouped = organisations.value
    .map(organisation => ({
      id: organisation.slug,
      label: organisation.name,
      projects: visibleProjects.value.filter(project => project.organisationId === organisation.id),
    }))
    .filter(group => group.projects.length > 0)
  const ungrouped = visibleProjects.value.filter(
    project => !project.organisationId || !known.has(project.organisationId),
  )
  return ungrouped.length ? [...grouped, { id: 'ungrouped', label: 'No organisation', projects: ungrouped }] : grouped
})

const formOpen = ref(false)
const editing = ref<Workspace | null>(null)

function openCreate() {
  editing.value = null
  formOpen.value = true
}

function openEdit(project: Workspace) {
  editing.value = project
  formOpen.value = true
}

async function onSaved(project: Workspace, created: boolean, notes: ProjectFormSaveNote[]) {
  await refreshProjectData()
  const descriptions = notes.flatMap(note => (note.description ? [note.description] : []))
  toast.add({
    title: created ? `Created ${project.name}` : `Saved ${project.name}`,
    description: descriptions.length ? descriptions.join(' ') : undefined,
    color: notes.find(note => note.color)?.color ?? 'success',
  })
}

const actionError = ref<ApiErrorInfo | null>(null)

async function runAction(action: () => Promise<unknown>) {
  actionError.value = null
  try {
    await action()
    await refreshProjectData()
  }
  catch (error) {
    actionError.value = toApiError(error)
  }
}

function projectPath(project: Workspace, suffix = '') {
  return `${WORKSPACES_PATH}/${project.slug}${suffix}`
}

function runRowAction(action: ProjectRowAction, project: Workspace) {
  return runAction(async () => {
    const note = await action.run(project)
    if (note) toast.add(note)
  })
}

async function archive(project: Workspace) {
  const confirmed = await confirm.open({
    title: `Archive ${project.name}?`,
    description: `It disappears from the ${SCOPE.singular} picker but keeps its slug and settings. You can unarchive it later.`,
    confirmLabel: 'Archive',
    color: 'warning',
  }).result
  if (confirmed) await runAction(() => $api(projectPath(project, '/archive'), { method: 'POST' }))
}

function unarchive(project: Workspace) {
  return runAction(() => $api(projectPath(project, '/unarchive'), { method: 'POST' }))
}

async function remove(project: Workspace) {
  const confirmed = await confirm.open({
    title: `Delete ${project.name}?`,
    description: `This removes the ${SCOPE.singular} and everything ${PRODUCT.name} stores for it. Files on disk are not touched.`,
    confirmLabel: `Delete ${SCOPE.singular}`,
  }).result
  if (confirmed) await runAction(() => $api(projectPath(project), { method: 'DELETE' }))
}
</script>

<template>
  <UDashboardPanel id="projects">
    <template #header>
      <UDashboardNavbar :title="SCOPE.pluralTitle">
        <template #right>
          <USwitch
            v-model="showArchived"
            :label="`Show archived (${archivedCount})`"
            size="sm"
            data-testid="show-archived"
          />
          <UButton icon="i-lucide-plus" :label="newLabel" data-testid="new-project" @click="openCreate" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div class="flex min-w-0 flex-col gap-4">
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
            :title="`Could not load ${SCOPE.plural}`"
            :description="toApiError(loadError).message"
          />

          <div v-if="status === 'pending' && !projects.length" class="flex flex-col gap-2">
            <USkeleton v-for="n in 3" :key="n" class="h-14 w-full" />
          </div>
          <ProjectsList
            v-else-if="groups.length"
            :groups="groups"
            @edit="openEdit"
            @action="runRowAction"
            @archive="archive"
            @unarchive="unarchive"
            @delete="remove"
          />
          <UEmpty
            v-else
            icon="i-lucide-folder-git-2"
            :title="projects.length ? `All ${SCOPE.plural} are archived` : `No ${SCOPE.plural} yet`"
            :description="`Add ${SCOPE.aSingular} to start working on it.`"
            :actions="[{ label: newLabel, icon: 'i-lucide-plus', onClick: openCreate }]"
          />
        </div>

        <ProjectsOrganisations :organisations="organisations" :projects="projects" />
      </div>

      <ProjectsFormModal
        v-model:open="formOpen"
        :project="editing"
        :organisations="organisations"
        @saved="onSaved"
      />
    </template>
  </UDashboardPanel>
</template>
