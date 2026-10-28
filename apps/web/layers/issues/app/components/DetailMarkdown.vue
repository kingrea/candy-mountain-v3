<script setup lang="ts">
const props = defineProps<{ source: string }>()

const html = computed(() => issuesRenderMarkdown(props.source))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- issuesRenderMarkdown escapes raw HTML and refuses unsafe URLs -->
  <div class="issues-markdown text-sm text-default" v-html="html" />
</template>

<style scoped>
.issues-markdown {
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.issues-markdown > :deep(* + *) {
  margin-top: 0.75rem;
}

.issues-markdown :deep(h1),
.issues-markdown :deep(h2),
.issues-markdown :deep(h3),
.issues-markdown :deep(h4),
.issues-markdown :deep(h5),
.issues-markdown :deep(h6) {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.issues-markdown :deep(h1) {
  font-size: 1.25rem;
}

.issues-markdown :deep(h2) {
  font-size: 1.125rem;
}

.issues-markdown :deep(h3) {
  font-size: 1rem;
}

.issues-markdown :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.issues-markdown :deep(strong) {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.issues-markdown :deep(ul) {
  list-style: disc;
  padding-left: 1.25rem;
}

.issues-markdown :deep(ol) {
  list-style: decimal;
  padding-left: 1.25rem;
}

.issues-markdown :deep(li + li),
.issues-markdown :deep(li > ul),
.issues-markdown :deep(li > ol) {
  margin-top: 0.25rem;
}

.issues-markdown :deep(li:has(> input[type='checkbox'])) {
  list-style: none;
}

.issues-markdown :deep(input[type='checkbox']) {
  margin-right: 0.375rem;
}

.issues-markdown :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  padding: 0.125rem 0.25rem;
  border-radius: calc(var(--ui-radius) * 0.75);
  background: var(--ui-bg-elevated);
}

.issues-markdown :deep(pre) {
  overflow-x: auto;
  padding: 0.75rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.issues-markdown :deep(pre code) {
  padding: 0;
  background: transparent;
}

.issues-markdown :deep(blockquote) {
  padding-left: 0.75rem;
  border-left: 3px solid var(--ui-border-accented);
  color: var(--ui-text-muted);
}

.issues-markdown :deep(hr) {
  border-color: var(--ui-border);
}

.issues-markdown :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}

.issues-markdown :deep(th),
.issues-markdown :deep(td) {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--ui-border);
  text-align: left;
}

.issues-markdown :deep(th) {
  background: var(--ui-bg-elevated);
  font-weight: 600;
}

.issues-markdown :deep(img) {
  max-width: 100%;
}
</style>
