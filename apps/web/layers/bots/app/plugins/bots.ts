import { BOT_FAMILIES } from '@candy-mountain/shared'

// A bot agent carries its engine's family, so its threads arrive under that family's pieces.
export default defineNuxtPlugin(() => {
  const worktree = defineAsyncComponent(() => import('#layers/bots/app/components/ThreadWorktree.vue'))
  for (const family of BOT_FAMILIES) chatFamilyRegister(family, { id: 'bots', aboveTranscript: worktree })
})
