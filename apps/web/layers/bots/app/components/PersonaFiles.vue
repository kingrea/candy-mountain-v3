<script setup lang="ts">
import { BOT_FAMILY_NAMES } from '@candy-mountain/shared'
import type { BotsPersonaCheck } from '../utils/bots'

const props = defineProps<{
  check: BotsPersonaCheck
}>()

const rows = computed(() => botsPersonaFileRows(props.check))
</script>

<template>
  <div class="flex flex-col gap-1 text-sm" data-testid="persona-files">
    <span class="text-muted">On <span class="font-mono">{{ check.files.branch }}</span>:</span>
    <ul class="flex flex-col gap-1">
      <li
        v-for="row in rows"
        :key="row.family"
        class="flex items-center gap-1.5"
        :data-testid="`persona-file-${row.family}`"
        :data-found="row.found"
      >
        <UIcon
          :name="row.found ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
          :class="row.found ? 'text-success' : 'text-error'"
          class="size-4 shrink-0"
        />
        <span class="font-mono">{{ row.path }}</span>
        <span class="text-muted">{{ BOT_FAMILY_NAMES[row.family] }}, {{ row.found ? 'found' : 'not found' }}</span>
      </li>
    </ul>
  </div>
</template>
