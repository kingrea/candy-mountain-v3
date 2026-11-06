<script setup lang="ts">
const { slug } = useSelectedProject()
const live = useIssuesLiveRefresh(slug, () => (slug.value ? refreshNuxtData(issuesListKey(slug.value)) : Promise.resolve()))

const slideover = useIssuesSlideover(slug)

function openIssue(id: string) {
  slideover.open(id)
}
</script>

<template>
  <CapabilityViewGate capability="issues" view="issues">
    <UDashboardPanel id="issues">
      <template #header>
        <UDashboardNavbar title="Issues">
          <template #right>
            <IssuesLiveStatus :refreshing="live.refreshing.value" :lost="live.lost.value" />
            <IssuesAddButton />
          </template>
        </UDashboardNavbar>
        <UDashboardToolbar v-if="slug">
          <IssuesToolbar :key="slug" :slug="slug" />
        </UDashboardToolbar>
      </template>

      <template #body>
        <IssuesList v-if="slug" :key="slug" :slug="slug" @open="openIssue" />
        <IssuesSlideover v-if="slug" :key="slug" :slug="slug" />
        <IssuesBulkBar v-if="slug" :key="slug" :slug="slug" />
      </template>
    </UDashboardPanel>
  </CapabilityViewGate>
</template>
