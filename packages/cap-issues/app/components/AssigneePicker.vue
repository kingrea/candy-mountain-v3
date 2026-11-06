<script setup lang="ts">
const props = defineProps<{
  slug: string
  placeholder?: string
  disabled?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}>()

const assignee = defineModel<string | null>({ default: null })

const toast = useToast()
const { names, pending, add } = useIssuesAssignees(() => props.slug)
const items = computed(() => issuesAssigneeItems(names.value, assignee.value))
const saving = ref(false)

function select(value: string | null | undefined) {
  assignee.value = issuesAssigneeFromSelection(value)
}

async function create(raw: string) {
  const name = raw.trim()
  if (name === '') return
  saving.value = true
  try {
    assignee.value = await add(name)
  }
  catch (error) {
    toast.add({ title: 'Could not add assignee', description: error instanceof Error ? error.message : undefined, color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <USelectMenu
    :model-value="assignee ?? undefined"
    :items="items"
    value-key="value"
    create-item="always"
    :loading="pending || saving"
    :disabled="disabled || saving"
    :size="size"
    :placeholder="placeholder ?? 'Unassigned'"
    :search-input="{ placeholder: 'Find or add a name' }"
    @update:model-value="select"
    @create="create"
  />
</template>
