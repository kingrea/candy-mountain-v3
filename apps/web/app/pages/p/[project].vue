<template>
  <NuxtPage v-if="project" />
  <UDashboardPanel v-else id="project-unavailable">
    <template #header>
      <UDashboardNavbar title="Project" />
    </template>

    <template #body>
      <UEmpty
        v-if="status === 'error'"
        icon="i-lucide-circle-x"
        title="Couldn't load projects"
        description="The daemon answered with an error. Try again in a moment."
        :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', onClick: () => refresh() }]"
      />
      <UEmpty
        v-else
        icon="i-lucide-folder-x"
        title="Project not found"
        :description="`No active project has the slug “${slug}”. It may have been archived, renamed or deleted.`"
        :actions="[{ label: 'Go to projects', icon: 'i-lucide-folder-git-2', to: PROJECTS_PAGE_PATH }]"
      />
    </template>
  </UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })

const { slug, project, status, refresh, loaded } = useSelectedProject()
const lastProject = useLastProjectSlug()
const event = useRequestEvent()

await loaded

const missing = computed(() => status.value === 'success' && !project.value)

useHead({ title: () => project.value?.name ?? 'Project' })

watch(project, (current) => {
  if (current) lastProject.value = current.slug
}, { immediate: true })

watch(missing, (isMissing) => {
  if (isMissing && lastProject.value === slug.value) lastProject.value = null
}, { immediate: true })

if (event && missing.value) setResponseStatus(event, 404)
</script>
