<script setup lang="ts">
import claudeCode from '~/assets/icons/plugins/claude-code.svg?url'
import codex from '~/assets/icons/plugins/codex.svg?url'
import heroku from '~/assets/icons/plugins/heroku.svg?url'
import netlify from '~/assets/icons/plugins/netlify.svg?url'
import slack from '~/assets/icons/plugins/slack.svg?url'

const props = defineProps<{ type: string }>()

const icons: Record<string, string> = {
  'claude-code': claudeCode,
  codex,
  heroku,
  netlify,
  slack,
}
const src = computed(() => icons[props.type])
</script>

<template>
  <!-- The adjacent plugin name labels the icon in every view. -->
  <span class="inline-flex size-5 shrink-0 items-center justify-center text-muted" aria-hidden="true">
    <img
      v-if="src"
      :src="src"
      alt=""
      class="size-full object-contain"
      :class="{
        'dark:invert': type === 'codex',
        'rounded-sm bg-white p-0.5': type === 'netlify' || type === 'heroku',
      }"
    >
    <UIcon v-else :name="pluginTypeIcon(type)" class="size-full" />
  </span>
</template>
