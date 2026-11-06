<script setup lang="ts">
const route = useRoute()
const { slug } = useSelectedProject()
const issueId = computed(() => String(route.params.id))
const issueTitle = ref<string | null>(null)
const issueIsEpic = ref(false)
const showGraph = computed(() => issueIsEpic.value && route.query.view === 'graph')

watch(issueId, () => {
  issueTitle.value = null
  issueIsEpic.value = false
})

useHead({ title: () => issueTitle.value ?? issueId.value })
</script>

<template>
  <CapabilityViewGate capability="issues" view="issues">
    <UDashboardPanel id="issue">
      <template #header>
        <UDashboardNavbar :title="issueId" :ui="{ title: 'font-mono' }">
          <template #leading>
            <UButton
              v-if="slug"
              :to="issuesPagePath(slug)"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="ghost"
              aria-label="Back to issues"
            />
          </template>
          <template #right>
            <UButton
              v-if="issueIsEpic"
              :to="{ query: showGraph ? {} : { view: 'graph' } }"
              label="Dependencies"
              icon="i-lucide-git-fork"
              color="neutral"
              :variant="showGraph ? 'soft' : 'outline'"
              :aria-pressed="showGraph"
              data-testid="issue-graph-toggle"
            />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <IssuesDependencyGraph v-if="slug && showGraph" class="mx-auto w-full max-w-6xl" :slug="slug" :epic-id="issueId" />
        <div class="mx-auto w-full max-w-4xl">
          <IssuesDetail
            v-if="slug"
            :slug="slug"
            :issue-id="issueId"
            @loaded="issueTitle = $event.title; issueIsEpic = $event.type === 'epic'"
          >
            <template #comments>
              <IssuesComments :slug="slug" :issue-id="issueId" />
            </template>
          </IssuesDetail>
        </div>
      </template>
    </UDashboardPanel>
  </CapabilityViewGate>
</template>
