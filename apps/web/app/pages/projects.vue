<script setup lang="ts">
import { PROJECTS_PATH, type Project, type ProjectResponse } from '@candy-mountain/shared'
import ProjectsConfirmModal from '~/components/projects/ProjectsConfirmModal.vue'
import type { ProjectGroup } from '~/components/projects/ProjectsList.vue'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Projects' })

const { $api } = useNuxtApp()
const toast = useToast()
const confirm = useOverlay().create(ProjectsConfirmModal)

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
const editing = ref<Project | null>(null)

function openCreate() {
  editing.value = null
  formOpen.value = true
}

function openEdit(project: Project) {
  editing.value = project
  formOpen.value = true
}

async function onSaved(project: Project, created: boolean) {
  await refreshProjectData()
  toast.add({
    title: created ? `Created ${project.name}` : `Saved ${project.name}`,
    description: verificationSummary(project),
    color: project.verification.pathExists ? 'success' : 'warning',
  })
}

function verificationSummary(project: Project): string {
  const v = project.verification
  if (!v.pathExists) return 'Path not found.'
  const issues = v.hasBeads ? 'issue tracker found' : 'no issue tracker'
  const git = !v.isGitRepo ? 'not a git repo' : v.hasRemote ? `git remote ${v.remoteName}` : 'no git remote'
  return `Path checked: ${issues}, ${git}.`
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

function projectPath(project: Project, suffix = '') {
  return `${PROJECTS_PATH}/${project.slug}${suffix}`
}

function verify(project: Project) {
  return runAction(async () => {
    const response = await $api<ProjectResponse>(projectPath(project, '/verify'), { method: 'POST' })
    toast.add({ title: `Checked ${project.name}`, description: verificationSummary(response.project) })
  })
}

async function archive(project: Project) {
  const confirmed = await confirm.open({
    title: `Archive ${project.name}?`,
    description: 'It disappears from the project picker but keeps its slug and settings. You can unarchive it later.',
    confirmLabel: 'Archive',
    color: 'warning',
  }).result
  if (confirmed) await runAction(() => $api(projectPath(project, '/archive'), { method: 'POST' }))
}

function unarchive(project: Project) {
  return runAction(() => $api(projectPath(project, '/unarchive'), { method: 'POST' }))
}

async function remove(project: Project) {
  const confirmed = await confirm.open({
    title: `Delete ${project.name}?`,
    description: 'This removes the project and everything Candy Mountain stores for it. Files on disk are not touched.',
    confirmLabel: 'Delete project',
  }).result
  if (confirmed) await runAction(() => $api(projectPath(project), { method: 'DELETE' }))
}
</script>

<template>
  <UDashboardPanel id="projects">
    <template #header>
      <UDashboardNavbar title="Projects">
        <template #right>
          <USwitch
            v-model="showArchived"
            :label="`Show archived (${archivedCount})`"
            size="sm"
            data-testid="show-archived"
          />
          <UButton icon="i-lucide-plus" label="New project" data-testid="new-project" @click="openCreate" />
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
            title="Could not load projects"
            :description="toApiError(loadError).message"
          />

          <div v-if="status === 'pending' && !projects.length" class="flex flex-col gap-2">
            <USkeleton v-for="n in 3" :key="n" class="h-14 w-full" />
          </div>
          <ProjectsList
            v-else-if="groups.length"
            :groups="groups"
            @edit="openEdit"
            @verify="verify"
            @archive="archive"
            @unarchive="unarchive"
            @delete="remove"
          />
          <UEmpty
            v-else
            icon="i-lucide-folder-git-2"
            :title="projects.length ? 'All projects are archived' : 'No projects yet'"
            description="Register a local codebase to start working on it."
            :actions="[{ label: 'New project', icon: 'i-lucide-plus', onClick: openCreate }]"
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
