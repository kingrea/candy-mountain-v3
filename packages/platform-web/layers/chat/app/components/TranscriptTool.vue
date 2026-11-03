<template>
  <UChatTool
    :text="item.title"
    :suffix="suffix"
    :icon="icon"
    :loading="item.running"
    variant="card"
    :ui="{ leadingIcon: item.status === 'failed' ? 'text-error' : undefined, body: 'max-h-80 space-y-2' }"
    data-testid="chat-tool"
    :data-status="item.status"
    :data-tool-call-id="item.toolCallId"
  >
    <div v-if="input" class="space-y-1">
      <p class="text-xs font-medium text-muted">
        Input
      </p>
      <pre class="overflow-x-auto font-mono text-xs text-default">{{ input }}</pre>
    </div>
    <div v-if="item.output.length || rawOutput" class="space-y-1" data-testid="chat-tool-output">
      <p class="text-xs font-medium text-muted">
        {{ item.status === 'failed' ? 'Error' : 'Result' }}
      </p>
      <template v-for="(part, index) in item.output" :key="index">
        <pre v-if="part.type === 'text'" class="overflow-x-auto font-mono text-xs text-default">{{ part.text }}</pre>
        <div v-else-if="part.type === 'diff'" class="space-y-1">
          <p class="truncate font-mono text-xs text-muted">
            {{ part.path }}
          </p>
          <pre class="overflow-x-auto font-mono text-xs"><span v-for="(line, lineIndex) in diffLines(part.oldText, part.newText)" :key="lineIndex" class="block" :class="line.startsWith('+') ? 'text-success' : 'text-error'">{{ line }}</span></pre>
        </div>
        <p v-else class="text-xs text-muted italic">
          {{ part.label }}
        </p>
      </template>
      <pre v-if="!item.output.length && rawOutput" class="overflow-x-auto font-mono text-xs text-default">{{ rawOutput }}</pre>
    </div>
  </UChatTool>
</template>

<script setup lang="ts">
const props = defineProps<{ item: ChatToolItem }>()

const ICONS: Record<string, string> = {
  read: 'i-lucide-file-text',
  edit: 'i-lucide-file-pen',
  delete: 'i-lucide-trash-2',
  move: 'i-lucide-move',
  search: 'i-lucide-search',
  execute: 'i-lucide-terminal',
  think: 'i-lucide-brain',
  fetch: 'i-lucide-globe',
  switch_mode: 'i-lucide-toggle-left',
}

const icon = computed(() => {
  if (props.item.status === 'failed') return 'i-lucide-circle-x'
  return ICONS[props.item.toolKind ?? ''] ?? 'i-lucide-wrench'
})

const suffix = computed(() => {
  switch (props.item.status) {
    case 'failed': return 'failed'
    case 'completed': return undefined
    default: return props.item.running ? (props.item.status === 'pending' ? 'waiting' : 'running') : 'did not finish'
  }
})

function show(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && !Array.isArray(value) && typeof (value as { command?: unknown }).command === 'string') {
    return `$ ${(value as { command: string }).command}`
  }
  return JSON.stringify(value, null, 2)
}

const input = computed(() => {
  const value = props.item.input
  if (value && typeof value === 'object' && Object.keys(value).length === 0) return ''
  return show(value)
})
const rawOutput = computed(() => show(props.item.rawOutput))

function diffLines(oldText: string | null, newText: string): string[] {
  const removed = oldText ? oldText.split('\n').map(line => `- ${line}`) : []
  return [...removed, ...newText.split('\n').map(line => `+ ${line}`)]
}
</script>
