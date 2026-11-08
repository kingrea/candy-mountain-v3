<script setup lang="ts">
import type { IconSource } from '@candy-mountain/platform-sdk'

defineProps<{ icon: IconSource }>()
</script>

<template>
  <img v-if="'src' in icon" :src="icon.src" alt="" class="object-contain" :class="icon.class">
  <UIcon v-else :name="icon.name" />
</template>
