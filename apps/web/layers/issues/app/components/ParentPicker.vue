<script setup lang="ts">
import type { Issue } from '@candy-mountain/shared'

const props = defineProps<{
  slug: string
  /** The issue being re-parented: it and its descendants are not offered. */
  issueId?: string
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  defaultOpen?: boolean
}>()

const parentId = defineModel<string | null>({ default: null })

const api = useIssuesApi()
const issues = ref<Issue[]>([])
const pending = ref(true)
const loadError = ref<ApiErrorInfo | null>(null)
const items = computed(() => issuesPickerItems(issuesParentCandidates(issues.value, props.issueId)))
const filterFields = ['label', 'value']

onMounted(async () => {
  try {
    issues.value = (await api.list(props.slug)).issues
  }
  catch (error) {
    loadError.value = toApiError(error)
  }
  finally {
    pending.value = false
  }
})
</script>

<template>
  <USelectMenu
    v-model="parentId"
    :items="items"
    value-key="value"
    :filter-fields="filterFields"
    :search-input="{ placeholder: 'Search by title or id' }"
    :loading="pending || loading"
    :disabled="disabled"
    :default-open="defaultOpen"
    :placeholder="loadError ? `Couldn't load issues: ${loadError.message}` : (placeholder ?? 'No parent')"
    clear
    virtualize
  />
</template>
