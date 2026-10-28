<script setup lang="ts">
import { PROJECT_COLOR_PALETTE } from '@candy-mountain/shared'

const color = defineModel<string>({ required: true })

// The API accepts any hex colour, so a project saved elsewhere may sit outside the palette.
const swatches = computed<string[]>(() =>
  (PROJECT_COLOR_PALETTE as readonly string[]).includes(color.value) || !color.value
    ? [...PROJECT_COLOR_PALETTE]
    : [...PROJECT_COLOR_PALETTE, color.value],
)
</script>

<template>
  <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
    <button
      v-for="swatch in swatches"
      :key="swatch"
      type="button"
      role="radio"
      :aria-checked="swatch === color"
      :aria-label="swatch"
      class="size-7 rounded-full ring-offset-2 ring-offset-(--ui-bg) transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="swatch === color ? 'ring-2 ring-inverted' : 'hover:scale-110'"
      :style="{ backgroundColor: swatch }"
      @click="color = swatch"
    />
  </div>
</template>
