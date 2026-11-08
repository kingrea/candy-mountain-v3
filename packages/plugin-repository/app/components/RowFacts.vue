<script setup lang="ts">
const props = defineProps<ProjectRowItemProps>()

const { repository } = useRepository(() => props.project.slug)
</script>

<template>
  <RepositoryVerificationFacts v-if="repository" :verification="repository.verification" />
</template>
