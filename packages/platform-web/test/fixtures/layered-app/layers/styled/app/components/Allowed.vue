<template>
  <div class="styled-root">
    <UButton :ui="{ base: 'styled-button' }" label="Go" />
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
.styled-root {
  --styled-edge-color: var(--styled-edge, var(--ui-border-accented));
  --styled-surface: var(--app-bg-shell);
  border-color: var(--styled-edge-color);
  background: var(--styled-surface);
  border-radius: calc(var(--ui-radius) * 0.75);
}

:where(.styled-root) {
  --styled-text: var(--ui-text-highlighted);
}

.styled-root :deep(h1),
.styled-root :deep(.other-markup) {
  color: var(--styled-text);
}

.styled-root[title='body'] {
  content: 'html';
}

@media (prefers-color-scheme: dark) {
  .styled-root {
    --styled-surface: var(--ui-bg-elevated);
  }
}

@layer styled-cards {
  .styled-root .card {
    @apply rounded;
  }
}
</style>

<style module>
.note {
  color: var(--ui-text-muted);
}
</style>
