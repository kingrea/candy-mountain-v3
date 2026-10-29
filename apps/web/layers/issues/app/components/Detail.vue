<script setup lang="ts">
import type { IssueDetail, IssueLink, IssueType } from '@candy-mountain/shared'
import type { IssuesEditDraft, IssuesEditField, IssuesEditableValues } from '#layers/issues/app/utils/issues-edit'

const props = defineProps<{
  slug: string
  issueId: string
  /** When set, a plain click on a linked issue calls this instead of navigating to its page. */
  onOpenIssue?: (id: string) => void
}>()

const emit = defineEmits<{ loaded: [issue: IssueDetail] }>()

defineSlots<{
  run?: (props: { issue: IssueDetail }) => unknown
  comments?: (props: { issue: IssueDetail, refresh: () => Promise<void> }) => unknown
}>()

const api = useIssuesApi()
const toast = useToast()
const { registry } = useProjectRegistry()

const { data, status, error, refresh } = useAsyncData(
  () => `issues:detail:${props.slug}:${props.issueId}`,
  () => api.show(props.slug, props.issueId).then(response => response.issue),
)

useIssuesEvents(() => props.slug, () => refresh())
defineExpose({ refresh })

const STATUS_ICON_CLASSES: Record<string, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  neutral: 'text-muted',
}

const issue = computed(() => data.value ?? null)
const loadError = computed(() => (error.value ? toApiError(error.value) : null))
const notFound = computed(() => loadError.value?.code === 'not_found' || error.value?.statusCode === 404)
const canEdit = computed(() => issuesCanWrite(registry.value))

watch(issue, (current) => {
  if (current) emit('loaded', current)
}, { immediate: true })

const labels = computed(() => issuesSplitLabels(issue.value?.labels ?? []))
const links = computed(() => (issue.value ? issuesDetailLinkGroups(issue.value) : null))
const linkGroups = computed(() => [
  { id: 'depends-on', title: 'Depends on', items: links.value?.dependsOn ?? [] },
  { id: 'dependents', title: 'Dependents', items: links.value?.dependents ?? [] },
  { id: 'children', title: 'Children', items: links.value?.children ?? [] },
].filter(group => group.items.length > 0))

const TEXT_SECTIONS = [
  { id: 'description', field: 'description', title: 'Description' },
  { id: 'acceptance', field: 'acceptanceCriteria', title: 'Acceptance criteria' },
  { id: 'notes', field: 'notes', title: 'Notes' },
] as const

const sections = computed(() => TEXT_SECTIONS
  .map(section => ({ ...section, body: issue.value?.[section.field] ?? null }))
  .filter(section => canEdit.value || Boolean(section.body?.trim())))

const edit = useIssuesEdit(() => props.slug, () => props.issueId, {
  onSaved: (saved) => {
    data.value = saved
    void refresh()
  },
})

const HEADER_TARGETS: readonly string[] = ['title', 'type', 'priority', 'labels', 'parentId', 'assignee']
const headerFailure = computed(() => {
  const failure = edit.failure.value
  return failure && HEADER_TARGETS.includes(failure.target) ? failure : null
})

const titleEditing = ref(false)
const titleDraft = ref('')
const parentEditing = ref(false)
const labelOpen = ref(false)
const labelDraft = ref('')
const labelProblem = ref<string | null>(null)
const closeOpen = ref(false)
const closeReason = ref('')

// Values derive from the loaded issue rather than from refs synced by a watcher, which never runs during SSR.
const inFlight = ref<IssuesEditDraft>({})

function shown<F extends IssuesEditField>(field: F): IssuesEditableValues[F] | undefined {
  const draft: IssuesEditDraft = inFlight.value
  return field in draft ? draft[field] : issue.value?.[field]
}

const shownType = computed<IssueType>(() => shown('type') ?? 'task')
const shownPriority = computed(() => shown('priority') ?? 2)

watch(() => props.issueId, () => {
  titleEditing.value = false
  parentEditing.value = false
  edit.clearError()
})

async function saveField(field: IssuesEditField, value: unknown): Promise<boolean> {
  if (!issue.value) return false
  inFlight.value = { ...inFlight.value, [field]: value }
  try {
    return await edit.save(field, issue.value, { [field]: value })
  }
  finally {
    const { [field]: _, ...rest } = inFlight.value
    inFlight.value = rest
  }
}

function startTitleEdit() {
  if (!issue.value) return
  titleDraft.value = issue.value.title
  titleEditing.value = true
}

function cancelTitleEdit() {
  titleEditing.value = false
  edit.clearError('title')
}

async function saveTitle() {
  if (await saveField('title', titleDraft.value)) titleEditing.value = false
}

async function saveParent(parentId: string | null | undefined) {
  if (await saveField('parentId', parentId ?? null)) parentEditing.value = false
}

function cancelParentEdit() {
  parentEditing.value = false
  edit.clearError('parentId')
}

watch(labelOpen, (open) => {
  if (!open) {
    labelDraft.value = ''
    labelProblem.value = null
  }
})

async function addLabel() {
  if (!issue.value) return
  labelProblem.value = issuesLabelProblem(labelDraft.value)
  if (labelProblem.value) return
  if (await saveField('labels', issuesLabelsAdd(issue.value.labels, labelDraft.value))) labelOpen.value = false
}

function removeLabel(label: string) {
  if (issue.value) void saveField('labels', issuesLabelsRemove(issue.value.labels, label))
}

watch(closeOpen, (open) => {
  if (open) {
    closeReason.value = ''
    edit.clearError('close')
  }
})

async function closeIssue(force: boolean) {
  if (await edit.close(closeReason.value, force)) {
    closeOpen.value = false
    toast.add({ title: `Closed ${props.issueId}`, icon: 'i-lucide-circle-check', color: 'success' })
  }
}

function openIssue(event: MouseEvent, id: string) {
  if (!props.onOpenIssue || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  props.onOpenIssue(id)
}

function linkTitle(link: IssueLink): string {
  return `${link.id}: ${link.title}`
}

async function copyId() {
  try {
    await navigator.clipboard.writeText(props.issueId)
    toast.add({ title: 'Issue id copied', description: props.issueId, icon: 'i-lucide-check' })
  }
  catch {
    toast.add({ title: 'Could not copy the id', color: 'error' })
  }
}
</script>

<template>
  <div class="flex flex-col gap-6" data-testid="issue-detail">
    <USkeleton v-if="!issue && status !== 'error'" class="h-48 w-full" />

    <UEmpty
      v-else-if="notFound"
      icon="i-lucide-file-question"
      title="Issue not found"
      :description="`No issue has the id “${issueId}” in this project. It may have been deleted.`"
      :actions="[{ label: 'Back to issues', icon: 'i-lucide-arrow-left', to: issuesPagePath(slug) }]"
      data-testid="issue-not-found"
    />

    <UEmpty
      v-else-if="!issue"
      icon="i-lucide-circle-x"
      title="Couldn't load this issue"
      :description="loadError?.message"
      :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', onClick: () => refresh() }]"
      data-testid="issue-error"
    />

    <template v-else>
      <header class="flex flex-col gap-3">
        <div class="flex items-start justify-between gap-3">
          <form v-if="titleEditing" class="flex min-w-0 flex-1 flex-wrap items-center gap-2" @submit.prevent="saveTitle">
            <UInput
              v-model="titleDraft"
              size="lg"
              autofocus
              aria-label="Title"
              class="min-w-0 flex-1"
              data-testid="issue-title-input"
              @keydown.esc="cancelTitleEdit"
            />
            <UButton type="submit" label="Save" :loading="edit.isSaving('title')" data-testid="issue-title-save" />
            <UButton label="Cancel" color="neutral" variant="ghost" :disabled="edit.isSaving('title')" @click="cancelTitleEdit" />
          </form>
          <h1 v-else class="min-w-0 text-xl font-semibold text-highlighted" data-testid="issue-title">
            <button
              v-if="canEdit"
              type="button"
              title="Click to edit the title"
              class="-mx-1 rounded-md px-1 text-left hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              @click="startTitleEdit"
            >
              {{ issue.title }}
            </button>
            <template v-else>
              {{ issue.title }}
            </template>
          </h1>

          <div class="flex shrink-0 items-center gap-2">
            <UPopover v-if="canEdit && issue.status !== 'closed'" v-model:open="closeOpen">
              <UButton label="Close" icon="i-lucide-circle-check" color="neutral" variant="outline" data-testid="issue-close" />
              <template #content>
                <form class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 p-3" @submit.prevent="closeIssue(false)">
                  <UTextarea
                    v-model="closeReason"
                    :rows="2"
                    autoresize
                    autofocus
                    placeholder="Reason (optional)"
                    aria-label="Close reason"
                    class="w-full"
                    data-testid="issue-close-reason-input"
                  />
                  <UAlert
                    v-if="edit.errorFor('close')"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-circle-alert"
                    title="Couldn't close the issue"
                    :description="edit.errorFor('close')?.message"
                    data-testid="issue-close-error"
                  />
                  <div class="flex justify-end gap-2">
                    <UButton
                      v-if="edit.errorFor('close')?.code === 'tracker_failed'"
                      label="Close anyway"
                      color="warning"
                      variant="soft"
                      :loading="edit.isSaving('close')"
                      data-testid="issue-close-force"
                      @click="closeIssue(true)"
                    />
                    <UButton type="submit" label="Close issue" :loading="edit.isSaving('close')" data-testid="issue-close-submit" />
                  </div>
                </form>
              </template>
            </UPopover>
            <slot name="run" :issue="issue">
              <IssuesRunButton :slug="slug" :ids="[issue.id]" />
            </slot>
          </div>
        </div>

        <div class="flex items-center gap-1 text-sm text-muted">
          <span class="font-mono" data-testid="issue-id">{{ issue.id }}</span>
          <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" aria-label="Copy issue id" @click="copyId" />
        </div>

        <div class="flex flex-wrap items-center gap-2" data-testid="issue-badges">
          <UBadge v-bind="issuesStatusMeta(issue.status)" variant="subtle" data-testid="issue-status" />
          <template v-if="canEdit">
            <USelect
              :model-value="shownType"
              :items="issuesTypeItems(issue.type)"
              :icon="issuesTypeMeta(shownType).icon"
              :color="issuesTypeMeta(shownType).color"
              :ui="{ leadingIcon: issuesTypeColorClass(shownType) }"
              variant="soft"
              size="xs"
              :loading="edit.isSaving('type')"
              :disabled="edit.isSaving('type')"
              aria-label="Type"
              data-testid="issue-type"
              @update:model-value="saveField('type', $event)"
            >
              <!-- The slot replaces the default option icon, whose highlighted state would drop the type colour. -->
              <template #item-leading="{ item }">
                <UIcon :name="item.icon" class="size-4 shrink-0" :class="issuesTypeColorClass(item.value)" />
              </template>
            </USelect>
            <USelect
              :model-value="shownPriority"
              :items="ISSUES_PRIORITY_ITEMS"
              icon="i-lucide-flame"
              color="neutral"
              :ui="{ leadingIcon: issuesPriorityFlameClass(shownPriority) }"
              variant="soft"
              size="xs"
              :loading="edit.isSaving('priority')"
              :disabled="edit.isSaving('priority')"
              aria-label="Priority"
              data-testid="issue-priority"
              @update:model-value="saveField('priority', $event)"
            >
              <!-- The slot replaces the default option icon, whose highlighted state would recolour the flame. -->
              <template #item-leading="{ item }">
                <UIcon name="i-lucide-flame" class="size-4 shrink-0" :class="issuesPriorityFlameClass(item.value)" />
              </template>
            </USelect>
          </template>
          <template v-else>
            <UBadge v-bind="issuesTypeMeta(issue.type)" variant="subtle" data-testid="issue-type" />
            <UBadge
              v-bind="issuesPriorityMeta(issue.priority)"
              variant="outline"
              :ui="{ leadingIcon: issuesPriorityFlameClass(issue.priority) }"
              data-testid="issue-priority"
            />
          </template>
          <UBadge v-if="issue.ready" label="Ready" icon="i-lucide-zap" color="success" variant="outline" />
          <UBadge
            v-for="stage in labels.stages"
            :key="stage"
            :label="stage"
            icon="i-lucide-milestone"
            color="secondary"
            variant="soft"
            data-testid="issue-stage"
          >
            <template v-if="canEdit" #trailing>
              <button
                type="button"
                class="ms-0.5 -me-0.5 inline-flex items-center justify-center self-center rounded-sm hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
                :aria-label="`Remove label ${stage}`"
                :disabled="edit.isSaving('labels')"
                data-testid="issue-label-remove"
                @click="removeLabel(stage)"
              >
                <UIcon name="i-lucide-x" class="size-3" />
              </button>
            </template>
          </UBadge>
          <UBadge
            v-for="label in labels.labels"
            :key="label"
            :label="label"
            icon="i-lucide-tag"
            color="neutral"
            variant="outline"
            data-testid="issue-label"
          >
            <template v-if="canEdit" #trailing>
              <button
                type="button"
                class="ms-0.5 -me-0.5 inline-flex items-center justify-center self-center rounded-sm hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
                :aria-label="`Remove label ${label}`"
                :disabled="edit.isSaving('labels')"
                data-testid="issue-label-remove"
                @click="removeLabel(label)"
              >
                <UIcon name="i-lucide-x" class="size-3" />
              </button>
            </template>
          </UBadge>
          <UPopover v-if="canEdit" v-model:open="labelOpen">
            <UButton
              label="Label"
              icon="i-lucide-plus"
              size="xs"
              color="neutral"
              variant="ghost"
              :loading="edit.isSaving('labels')"
              data-testid="issue-label-add"
            />
            <template #content>
              <form class="flex w-64 flex-col gap-2 p-2" @submit.prevent="addLabel">
                <div class="flex gap-2">
                  <UInput
                    v-model="labelDraft"
                    size="sm"
                    autofocus
                    placeholder="New label"
                    aria-label="New label"
                    class="min-w-0 flex-1"
                    data-testid="issue-label-input"
                  />
                  <UButton type="submit" label="Add" size="sm" :loading="edit.isSaving('labels')" />
                </div>
                <p v-if="labelProblem" class="text-xs text-error">
                  {{ labelProblem }}
                </p>
              </form>
            </template>
          </UPopover>
        </div>
      </header>

      <UAlert
        v-if="headerFailure"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="`Couldn't save the ${ISSUES_EDIT_FIELD_LABELS[headerFailure.target as IssuesEditField]}`"
        :description="headerFailure.error.message"
        close
        data-testid="issue-edit-error"
        @update:open="edit.clearError()"
      />

      <dl class="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm" data-testid="issue-fields">
        <dt class="text-muted">
          Assignee
        </dt>
        <dd data-testid="issue-assignee">
          <IssuesAssigneePicker
            v-if="canEdit"
            :model-value="shown('assignee') ?? null"
            :slug="slug"
            size="sm"
            :disabled="edit.isSaving('assignee')"
            class="w-full max-w-xs"
            data-testid="issue-assignee-picker"
            @update:model-value="saveField('assignee', $event)"
          />
          <template v-else>
            <span v-if="issue.assignee">{{ issue.assignee }}</span>
            <span v-else class="text-dimmed">Unassigned</span>
          </template>
        </dd>

        <template v-if="issue.parentId || canEdit">
          <dt class="text-muted">
            Parent
          </dt>
          <dd class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="issue-parent">
            <template v-if="parentEditing">
              <IssuesParentPicker
                :model-value="shown('parentId') ?? null"
                :slug="slug"
                :issue-id="issue.id"
                :loading="edit.isSaving('parentId')"
                :disabled="edit.isSaving('parentId')"
                default-open
                size="sm"
                class="w-full max-w-md"
                data-testid="issue-parent-picker"
                @update:model-value="saveParent"
              />
              <UButton label="Cancel" size="xs" color="neutral" variant="ghost" @click="cancelParentEdit" />
            </template>
            <template v-else>
              <template v-if="issue.parentId">
                <ULink
                  :to="issuesPagePath(slug, issue.parentId)"
                  class="font-mono text-primary underline underline-offset-2"
                  @click="openIssue($event, issue.parentId)"
                >
                  {{ issue.parentId }}
                </ULink>
                <span v-if="links?.parent" class="text-muted">{{ links.parent.title }}</span>
              </template>
              <span v-else class="text-dimmed">No parent</span>
              <UButton
                v-if="canEdit"
                icon="i-lucide-pencil"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Change parent"
                data-testid="issue-parent-edit"
                @click="parentEditing = true"
              />
            </template>
          </dd>
        </template>

        <dt class="text-muted">
          Created
        </dt>
        <dd data-testid="issue-created">
          <NuxtTime v-if="issue.createdAt" :datetime="issue.createdAt" date-style="medium" time-style="short" />
          <span v-else class="text-dimmed">Unknown</span>
          <span v-if="issue.createdBy" class="text-muted"> by {{ issue.createdBy }}</span>
        </dd>

        <dt class="text-muted">
          Updated
        </dt>
        <dd data-testid="issue-updated">
          <NuxtTime v-if="issue.updatedAt" :datetime="issue.updatedAt" date-style="medium" time-style="short" />
          <span v-else class="text-dimmed">Unknown</span>
        </dd>

        <template v-if="issue.closedAt || issue.status === 'closed'">
          <dt class="text-muted">
            Closed
          </dt>
          <dd data-testid="issue-closed">
            <NuxtTime v-if="issue.closedAt" :datetime="issue.closedAt" date-style="medium" time-style="short" />
            <span v-else class="text-dimmed">Unknown</span>
          </dd>

          <dt class="text-muted">
            Close reason
          </dt>
          <dd class="whitespace-pre-line" data-testid="issue-close-reason">
            <span v-if="issue.closeReason">{{ issue.closeReason }}</span>
            <span v-else class="text-dimmed">None given</span>
          </dd>
        </template>
      </dl>

      <IssuesDetailTextSection
        v-for="section in sections"
        :key="section.id"
        :title="section.title"
        :source="section.body"
        :editable="canEdit"
        :saving="edit.isSaving(section.field)"
        :error="edit.errorFor(section.field)"
        :save="value => saveField(section.field, value)"
        :data-testid="`issue-${section.id}`"
        @cancel="edit.clearError(section.field)"
      />

      <section v-for="group in linkGroups" :key="group.id" class="flex flex-col gap-2" :data-testid="`issue-${group.id}`">
        <h2 class="text-sm font-semibold text-highlighted">
          {{ group.title }}
          <span class="font-normal text-muted">{{ group.items.length }}</span>
        </h2>
        <ul class="flex flex-col gap-1.5">
          <li v-for="link in group.items" :key="link.id" class="flex min-w-0 items-center gap-2 text-sm">
            <UIcon
              :name="issuesStatusMeta(link.status).icon"
              class="size-4 shrink-0"
              :class="STATUS_ICON_CLASSES[issuesStatusMeta(link.status).color]"
            />
            <span class="sr-only">{{ issuesStatusMeta(link.status).label }}</span>
            <ULink
              :to="issuesPagePath(slug, link.id)"
              :title="linkTitle(link)"
              class="shrink-0 font-mono text-primary underline underline-offset-2"
              @click="openIssue($event, link.id)"
            >
              {{ link.id }}
            </ULink>
            <span class="truncate" :class="link.status === 'closed' ? 'text-muted line-through' : 'text-default'">{{ link.title }}</span>
          </li>
        </ul>
      </section>

      <slot name="comments" :issue="issue" :refresh="refresh" />
    </template>
  </div>
</template>
