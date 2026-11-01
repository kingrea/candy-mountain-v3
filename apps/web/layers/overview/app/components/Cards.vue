<template>
  <component :is="card.component" v-for="card in cards" :key="card.id" />
</template>

<script setup lang="ts">
import type { ProjectHomeCardSlot } from '~/utils/project-home'

const props = defineProps<{
  name: ProjectHomeCardSlot
}>()

const cards = computed(() => projectHomeCards(props.name))
</script>
