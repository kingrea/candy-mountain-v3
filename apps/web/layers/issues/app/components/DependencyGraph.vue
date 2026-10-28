<script setup lang="ts">
import type { IssueStatus } from '@candy-mountain/shared'

const props = defineProps<{
  slug: string
  epicId: string
  /** When set, a plain click on a node calls this instead of navigating to its page. */
  onOpenIssue?: (id: string) => void
}>()

const TITLE_MAX_LENGTH = 30

const { issues, status, error, refresh } = useIssuesList(props.slug)
useIssuesEvents(() => props.slug, () => refresh())

const loadError = computed(() => (error.value ? toApiError(error.value) : null))
const graph = computed(() => issuesDependencyGraph(props.epicId, issues.value, issues.value.flatMap(issue => issue.dependencies)))
const statuses = computed(() => [...new Set(graph.value.nodes.map(node => node.issue.status))])
const summary = computed(() => {
  const { nodes, edges } = graph.value
  const issueCount = `${nodes.length} ${nodes.length === 1 ? 'issue' : 'issues'}`
  if (edges.length === 0) return `${issueCount}, no blocking dependencies between them`
  return `${issueCount}, ${edges.length} blocking ${edges.length === 1 ? 'edge' : 'edges'}`
})

// Nuxt UI only defines --ui-<colour> for the non-neutral colours.
function statusColour(status: IssueStatus): string {
  const { color } = issuesStatusMeta(status)
  return color === 'neutral' ? 'var(--ui-text-dimmed)' : `var(--ui-${color})`
}

function open(event: MouseEvent, id: string) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  if (props.onOpenIssue) props.onOpenIssue(id)
  else navigateTo(issuesPagePath(props.slug, id))
}
</script>

<template>
  <section class="flex flex-col gap-3" aria-label="Dependency graph" data-testid="issue-graph">
    <UEmpty
      v-if="loadError && issues.length === 0"
      icon="i-lucide-circle-x"
      title="Couldn't load issues"
      :description="loadError.message"
      :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', onClick: () => refresh() }]"
      data-testid="issue-graph-error"
    />
    <USkeleton v-else-if="status === 'pending' && issues.length === 0" class="h-40 w-full" />
    <UEmpty
      v-else-if="graph.nodes.length === 0"
      icon="i-lucide-git-fork"
      title="No child issues"
      description="This epic has no issues under it yet."
      data-testid="issue-graph-empty"
    />
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p class="text-muted" data-testid="issue-graph-summary">
          {{ summary }}
        </p>
        <ul class="flex flex-wrap items-center gap-3 text-xs text-muted" aria-label="Status colours">
          <li v-for="nodeStatus in statuses" :key="nodeStatus" class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full" :style="{ background: statusColour(nodeStatus) }" />
            {{ issuesStatusMeta(nodeStatus).label }}
          </li>
        </ul>
      </div>

      <div class="overflow-auto rounded-md border border-default bg-elevated/30 p-2">
        <svg
          :width="graph.width"
          :height="graph.height"
          :viewBox="`0 0 ${graph.width} ${graph.height}`"
          class="block"
          role="group"
          :aria-label="summary"
          data-testid="issue-graph-canvas"
        >
          <defs>
            <marker id="issue-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" class="graph-arrow" />
            </marker>
          </defs>

          <path
            v-for="edge in graph.edges"
            :key="`${edge.from}>${edge.to}`"
            :d="edge.path"
            class="graph-edge"
            :class="{ 'graph-edge-back': edge.back }"
            marker-end="url(#issue-graph-arrow)"
            :data-from="edge.from"
            :data-to="edge.to"
            data-testid="issue-graph-edge"
          />

          <a
            v-for="node in graph.nodes"
            :key="node.issue.id"
            :href="issuesPagePath(slug, node.issue.id)"
            :aria-label="`${node.issue.id}: ${node.issue.title} (${issuesStatusMeta(node.issue.status).label})`"
            class="graph-node"
            :class="{ 'graph-node-closed': node.issue.status === 'closed' }"
            :style="{ '--node-colour': statusColour(node.issue.status) }"
            :data-id="node.issue.id"
            data-testid="issue-graph-node"
            @click="open($event, node.issue.id)"
          >
            <title>{{ node.issue.id }}: {{ node.issue.title }}</title>
            <rect
              :x="node.x"
              :y="node.y"
              :width="ISSUES_GRAPH_NODE_WIDTH"
              :height="ISSUES_GRAPH_NODE_HEIGHT"
              rx="6"
              class="graph-node-box"
            />
            <text :x="node.x + 12" :y="node.y + 20" class="graph-node-id">{{ issuesShortId(node.issue.id) }}</text>
            <text :x="node.x + ISSUES_GRAPH_NODE_WIDTH - 12" :y="node.y + 20" text-anchor="end" class="graph-node-status">
              {{ issuesStatusMeta(node.issue.status).label }}
            </text>
            <text :x="node.x + 12" :y="node.y + 39" class="graph-node-title">{{ issuesGraphLabel(node.issue.title, TITLE_MAX_LENGTH) }}</text>
          </a>
        </svg>
      </div>
    </template>
  </section>
</template>

<style scoped>
.graph-edge {
  fill: none;
  stroke: var(--ui-border-accented);
  stroke-width: 1.5;
}

.graph-edge-back {
  stroke-dasharray: 4 3;
}

.graph-arrow {
  fill: var(--ui-border-accented);
}

.graph-node {
  cursor: pointer;
  outline: none;
}

.graph-node-box {
  fill: color-mix(in oklab, var(--node-colour) 10%, var(--ui-bg));
  stroke: var(--node-colour);
  stroke-width: 1.5;
}

.graph-node:hover .graph-node-box {
  fill: color-mix(in oklab, var(--node-colour) 20%, var(--ui-bg));
}

.graph-node:focus-visible .graph-node-box {
  stroke: var(--ui-primary);
  stroke-width: 3;
}

.graph-node-closed .graph-node-title {
  text-decoration: line-through;
  fill: var(--ui-text-muted);
}

.graph-node-id {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  fill: var(--ui-text-muted);
}

.graph-node-status {
  font-size: 11px;
  fill: var(--node-colour);
}

.graph-node-title {
  font-size: 12.5px;
  font-weight: 500;
  fill: var(--ui-text-highlighted);
}
</style>
