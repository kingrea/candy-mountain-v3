<script setup lang="ts">
import type { PluginInstance, PluginTypeInfo } from '@candy-mountain/shared'
import type { DropdownMenuItem } from '@nuxt/ui'
import ProjectsConfirmModal from '~/components/projects/ProjectsConfirmModal.vue'

const props = defineProps<{
  instance: PluginInstance
  /** Undefined when the daemon no longer registers the instance's type. */
  type?: PluginTypeInfo
  /** Capabilities waiting on this instance to be configured and healthy. */
  neededBy?: string[]
}>()

const emit = defineEmits<{
  edit: [instance: PluginInstance]
}>()

const { testPlugin, deletePlugin } = usePluginActions()
const confirm = useOverlay().create(ProjectsConfirmModal)

const name = computed(() => props.type?.name ?? props.instance.type)
const config = computed(() => pluginConfigSummary(props.type?.configFields ?? [], props.instance.config))
const secrets = computed(() => (props.type?.secretFields ?? []).map(field => ({
  name: field.name,
  label: field.label,
  set: props.instance.secrets[field.name] === 'set',
})))
const panel = computed(() => (props.type ? pluginPanelFor(props.type.id) : undefined))

const testing = ref(false)
const actionError = ref<ApiErrorInfo | null>(null)

async function test() {
  actionError.value = null
  testing.value = true
  try {
    await testPlugin(props.instance.id)
  }
  catch (error) {
    actionError.value = toApiError(error)
  }
  finally {
    testing.value = false
  }
}

async function remove() {
  const global = props.instance.scope === 'global'
  const confirmed = await confirm.open({
    title: `Delete the ${name.value} plugin?`,
    description: global
      ? 'It is shared by every project. Its saved secrets are deleted, and projects without their own plugin lose what it provides.'
      : 'Its saved secrets are deleted, and capabilities that need it stop working for this project.',
    confirmLabel: 'Delete plugin',
  }).result
  if (!confirmed) return
  actionError.value = null
  try {
    await deletePlugin(props.instance.id)
  }
  catch (error) {
    actionError.value = toApiError(error)
  }
}

const menu = computed<DropdownMenuItem[][]>(() => [
  ...(props.type ? [[{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => emit('edit', props.instance) }]] : []),
  [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: remove }],
])
</script>

<template>
  <UCard
    :ui="{ body: 'flex flex-col gap-3 p-4 sm:p-4' }"
    :data-plugin="instance.type"
    :data-plugin-id="instance.id"
    :data-scope="instance.scope"
  >
    <div class="flex flex-wrap items-start gap-3">
      <UIcon :name="pluginTypeIcon(instance.type)" class="mt-0.5 size-5 shrink-0 text-muted" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium text-highlighted">{{ name }}</span>
          <UBadge :label="PLUGIN_SCOPE_LABELS[instance.scope]" color="neutral" variant="outline" size="sm" />
          <UBadge v-if="!type" label="Unknown type" color="warning" variant="subtle" size="sm" />
          <UBadge
            v-if="neededBy?.length"
            :label="`Needed by ${neededBy.join(', ')}`"
            icon="i-lucide-triangle-alert"
            color="warning"
            variant="subtle"
            size="sm"
            data-testid="plugin-needed"
          />
        </div>
        <dl v-if="config.length || secrets.length" class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <div v-for="entry in config" :key="entry.name" class="flex min-w-0 gap-1">
            <dt class="text-muted">
              {{ entry.label }}
            </dt>
            <dd class="truncate font-mono text-default" :title="entry.value">
              {{ entry.value }}
            </dd>
          </div>
          <div v-for="secret in secrets" :key="secret.name" class="flex gap-1" :data-secret-state="secret.set ? 'set' : 'unset'">
            <dt class="text-muted">
              {{ secret.label }}
            </dt>
            <dd :class="secret.set ? 'text-success' : 'text-dimmed'">
              {{ secret.set ? 'set' : 'not set' }}
            </dd>
          </div>
        </dl>
      </div>
      <div class="flex items-center gap-1">
        <UButton
          v-if="type"
          label="Test connection"
          icon="i-lucide-plug-zap"
          size="sm"
          color="neutral"
          variant="outline"
          :loading="testing"
          data-testid="plugin-test"
          @click="test"
        />
        <UDropdownMenu :items="menu" :content="{ align: 'end' }">
          <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="`Actions for ${name}`"
            data-testid="plugin-menu"
          />
        </UDropdownMenu>
      </div>
    </div>

    <PluginsHealth :health="instance.health" />

    <UAlert
      v-if="actionError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="actionError.message"
      :description="actionError.code"
      :close="{ onClick: () => { actionError = null } }"
      data-testid="plugin-error"
    />

    <div v-if="panel && type" class="border-t border-default pt-3" data-testid="plugin-panel">
      <component :is="panel" :instance="instance" :type="type" />
    </div>
  </UCard>
</template>
