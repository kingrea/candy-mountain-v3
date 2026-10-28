<script setup lang="ts">
import type { PathVerification } from '@candy-mountain/shared'
import type { BadgeProps } from '@nuxt/ui'

const props = defineProps<{
  verification: PathVerification
}>()

interface Fact {
  id: string
  label: string
  icon: string
  color: BadgeProps['color']
  hint: string
}

const facts = computed<Fact[]>(() => {
  const v = props.verification
  if (!v.pathExists) {
    return [{ id: 'path', label: 'Path not found', icon: 'i-lucide-folder-x', color: 'error', hint: 'The path is missing or is not a directory.' }]
  }

  const issues: Fact = v.hasBeads
    ? { id: 'issues', label: 'Issue tracker', icon: 'i-lucide-list-checks', color: 'success', hint: 'A .beads directory was found.' }
    : { id: 'issues', label: 'No issue tracker', icon: 'i-lucide-list-x', color: 'warning', hint: 'No .beads directory at this path.' }

  let git: Fact
  if (!v.isGitRepo) {
    git = { id: 'git', label: 'Not a git repo', icon: 'i-lucide-git-branch', color: 'neutral', hint: 'The path is not inside a git work tree.' }
  }
  else if (v.hasRemote) {
    git = { id: 'git', label: `Remote: ${v.remoteName}`, icon: 'i-lucide-git-branch', color: 'success', hint: v.remoteUrl ?? '' }
  }
  else {
    git = { id: 'git', label: 'No git remote', icon: 'i-lucide-git-branch', color: 'warning', hint: 'A git repo with no remotes.' }
  }

  return [issues, git]
})
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
