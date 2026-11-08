<template>
  <div class="delta-root">
    <UButton :ui="{ base: 'delta-button' }" label="Go" />
    <p :class="$style.note">{{ CORE_LIMIT }}</p>
  </div>
</template>

<script setup lang="ts">
import { CORE_LIMIT } from '~/utils/core'
</script>

<!-- Every allowed form: scoped and module blocks, :deep, :where, nested dark variant, and prefixed knobs read
     with the shell variable as fallback (the layer never declares the knob itself). -->
<style scoped>
/* body and html in a comment, and :global here, are not selectors. */
.delta-root {
  --delta-edge-color: var(--delta-edge, var(--ui-border-accented));
  --delta-surface: var(--app-bg-shell);
  border-color: var(--delta-edge-color);
  background: var(--delta-surface);
  border-radius: calc(var(--ui-radius) * 0.75);
}

:where(.delta-root) {
  --delta-text: var(--ui-text-highlighted);
}

.delta-root :deep(h1),
.delta-root :deep(.other-markup) {
  color: var(--delta-text);
}

.delta-root[title='body'] {
  content: 'html';
}

@media (prefers-color-scheme: dark) {
  .delta-root {
    --delta-surface: var(--ui-bg-elevated);
  }
}

@layer delta-cards {
  .delta-root .card {
    @apply rounded;
  }
}
</style>

<style module>
.note {
  color: var(--ui-text-muted);
}
</style>
