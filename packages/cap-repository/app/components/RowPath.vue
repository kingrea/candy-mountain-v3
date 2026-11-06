<script setup lang="ts">
const props = defineProps<ProjectRowItemProps>()

const { repository } = useRepository(() => props.project.slug)
</script>

<template>
  <p v-if="repository" class="truncate font-mono text-xs text-muted" :title="repository.source.path">
    {{ repository.source.path }}
  </p>
</template>
