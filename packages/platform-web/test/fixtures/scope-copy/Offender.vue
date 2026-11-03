<script setup lang="ts">
const title = 'Manage projects'
const scope = 'project'
</script>

<template>
  <UButton :label="title" placeholder="Select a project" :data-scope="scope" data-testid="new-project">
    {{ scope === 'project' ? 'No projects yet' : title }}
  </UButton>
  <p>Project</p>
</template>
