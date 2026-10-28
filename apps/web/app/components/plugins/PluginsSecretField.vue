<script setup lang="ts">
import type { PluginSecretField, PluginSecretState } from '@candy-mountain/shared'

const props = defineProps<{
  field: PluginSecretField
  /** The saved state when editing; absent while creating. */
  saved?: PluginSecretState
}>()

const draft = defineModel<PluginSecretDraft>({ required: true })

const isSet = computed(() => props.saved === 'set')

function setMode(mode: PluginSecretMode) {
  draft.value = { mode, value: '' }
}
</script>

<template>
  <div class="flex flex-col gap-2" :data-secret="field.name" :data-secret-mode="draft.mode">
    <div v-if="isSet && draft.mode !== 'replace'" class="flex flex-wrap items-center gap-2">
      <UBadge
        v-if="draft.mode === 'keep'"
        label="Set"
        icon="i-lucide-lock"
        color="success"
        variant="subtle"
        data-testid="secret-set"
      />
      <UBadge v-else label="Will be cleared" icon="i-lucide-eraser" color="warning" variant="subtle" />
      <template v-if="draft.mode === 'keep'">
        <UButton label="Replace" size="xs" color="neutral" variant="outline" data-testid="secret-replace" @click="setMode('replace')" />
        <UButton
          v-if="!field.required"
          label="Clear"
          size="xs"
          color="error"
          variant="ghost"
          data-testid="secret-clear"
          @click="setMode('clear')"
        />
      </template>
      <UButton v-else label="Undo" size="xs" color="neutral" variant="ghost" @click="setMode('keep')" />
    </div>

    <div v-else class="flex items-center gap-2">
      <UInput
        v-model="draft.value"
        type="password"
        autocomplete="new-password"
        spellcheck="false"
        class="w-full font-mono"
        :placeholder="isSet ? 'New value' : saved === 'unset' ? 'Not set' : ''"
        :autofocus="isSet"
      />
      <UButton
        v-if="isSet"
        label="Keep saved"
        size="sm"
        color="neutral"
        variant="ghost"
        class="shrink-0"
        @click="setMode('keep')"
      />
    </div>
  </div>
</template>
