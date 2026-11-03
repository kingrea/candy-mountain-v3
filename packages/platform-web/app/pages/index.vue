<template>
  <div />
</template>

<script setup lang="ts">
definePageMeta({
  middleware: () => {
    const lastProject = useLastProjectSlug().value
    return navigateTo(lastProject ? projectPath(lastProject) : PROJECTS_PAGE_PATH, { replace: true })
  },
})
</script>
