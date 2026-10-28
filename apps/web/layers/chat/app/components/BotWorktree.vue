<template>
  <div class="shrink-0 space-y-2 border-b border-default px-3 py-2 text-xs" data-testid="chat-bot-worktree" :data-worktree="bot.worktree">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1 space-y-0.5">
        <p v-if="bot.branch" class="flex items-center gap-1.5 text-default">
          <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0 text-muted" />
          <span class="truncate font-mono" data-testid="chat-bot-branch" :title="bot.branch">{{ bot.branch }}</span>
        </p>
        <p v-if="bot.worktreePath" class="flex items-center gap-1.5 text-muted">
          <UIcon name="i-lucide-folder-git-2" class="size-3.5 shrink-0" />
          <span class="truncate font-mono" data-testid="chat-bot-path" :title="bot.worktreePath">{{ bot.worktreePath }}</span>
        </p>
      </div>
      <UButton
        v-if="bot.worktree === 'active'"
        icon="i-lucide-archive"
        label="Close thread"
        color="neutral"
        variant="outline"
        size="xs"
        :loading="closing"
        data-testid="chat-bot-close"
        @click="closeThread"
      />
    </div>
    <UAlert
      v-if="bot.keptUnpushed"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Unpushed work kept"
      :description="`${bot.unpushedReason ?? 'The worktree holds work that is not on the remote'}. The worktree stays until the work is pushed; close the thread again after pushing.`"
      data-testid="chat-bot-unpushed"
    />
    <p v-else-if="bot.worktree === 'released'" class="text-muted" data-testid="chat-bot-released">
      Worktree released; the branch is kept. Your next prompt starts a fresh worktree.
    </p>
  </div>
</template>

<script setup lang="ts">
import type { ChatThreadBot } from '@candy-mountain/shared'

const props = defineProps<{ bot: ChatThreadBot, threadId: string }>()
const emit = defineEmits<{ closed: [] }>()

const { slug } = useSelectedProject()
const { close } = useChatThreads(slug)
const toast = useToast()
const closing = ref(false)

async function closeThread() {
  closing.value = true
  try {
    const result = await close(props.threadId)
    if (result.released) toast.add({ title: 'Worktree released', description: `Branch ${result.bot.branch ?? ''} is kept.`, color: 'success', icon: 'i-lucide-archive' })
    emit('closed')
  }
  catch (cause) {
    toast.add({ title: 'Thread not closed', description: toApiError(cause).message, color: 'error', icon: 'i-lucide-circle-alert' })
  }
  finally {
    closing.value = false
  }
}
</script>
