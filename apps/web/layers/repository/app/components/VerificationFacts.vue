<script setup lang="ts">
import type { RepositoryVerification } from '@candy-mountain/platform-sdk'

const props = defineProps<{
  verification: RepositoryVerification
}>()

const facts = computed(() => repositoryVerificationFacts(props.verification))
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <UTooltip v-for="fact in facts" :key="fact.id" :text="fact.hint">
      <UBadge
        :label="fact.label"
        :icon="fact.icon"
        :color="fact.color"
        variant="subtle"
        size="sm"
        :data-fact="fact.id"
      />
    </UTooltip>
  </div>
</template>
