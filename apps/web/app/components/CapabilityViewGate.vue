<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import type { CapabilityId } from '@candy-mountain/shared'

const props = defineProps<{ capability: CapabilityId, view: string }>()

const { slug } = useSelectedProject()
const { registry, status, refresh } = useProjectRegistry()

const access = computed(() => (registry.value ? resolveViewAccess(registry.value, props.capability, props.view) : null))
const title = computed(() => (access.value && 'view' in access.value ? access.value.view.label : 'Unavailable'))

const lockout = computed(() => {
  if (access.value?.state !== 'not-ready') return null
  const { capability } = access.value
  const actions: ButtonProps[] = registry.value?.admin && slug.value
    ? lockoutActions(capability.reasons, slug.value).map((action, index) => ({ ...action, ...(index ? { color: 'neutral', variant: 'outline' } : {}) }))
    : []
  return { label: capability.label, reasons: capability.reasons.map(reason => reason.message), actions }
})

const modulesAction = computed<ButtonProps[]>(() =>
  slug.value ? [{ label: 'Open modules', icon: 'i-lucide-blocks', to: projectModulesPagePath(slug.value) }] : [],
)
</script>

<template>
  <slot v-if="access?.state === 'ready'" :capability="access.capability" :view="access.view" />
  <UDashboardPanel v-else :id="`gate-${capability}-${view}`">
    <template #header>
      <UDashboardNavbar :title="title" />
    </template>

    <template #body>
      <UEmpty
        v-if="lockout"
        icon="i-lucide-lock"
        :title="`${lockout.label} needs setup for this project`"
        :actions="lockout.actions"
        data-testid="view-lockout"
      >
        <template #description>
          <ul v-if="lockout.reasons.length" class="list-inside list-disc text-left">
            <li v-for="reason in lockout.reasons" :key="reason">
              {{ reason }}
            </li>
          </ul>
          <p v-else>
            An admin needs to finish setting it up before it can be used here.
          </p>
        </template>
      </UEmpty>
      <UEmpty
        v-else-if="access?.state === 'not-enabled'"
        icon="i-lucide-blocks"
        title="Not enabled for this project"
        description="Enable the module that includes this page to use it here."
        :actions="modulesAction"
        data-testid="view-not-enabled"
      />
      <UEmpty
        v-else-if="access?.state === 'not-granted'"
        icon="i-lucide-shield-off"
        title="Not available to you"
        description="Your role does not include this page for this project."
        data-testid="view-not-granted"
      />
      <UEmpty
        v-else-if="status === 'error'"
        icon="i-lucide-circle-x"
        title="Couldn't check access"
        description="The daemon did not answer with this project's capabilities. Try again in a moment."
        :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', onClick: () => refresh() }]"
      />
      <UEmpty v-else loading title="Checking access" />
    </template>
  </UDashboardPanel>
</template>
