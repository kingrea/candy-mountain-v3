<script setup lang="ts">
const props = defineProps<{ source: string }>()

const html = computed(() => chatRenderMarkdown(props.source))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- chatRenderMarkdown escapes raw HTML and refuses unsafe URLs -->
  <div class="chat-markdown text-sm" v-html="html" />
</template>

<style scoped>
.chat-markdown {
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.chat-markdown > :deep(* + *) {
  margin-top: 0.75rem;
}

.chat-markdown :deep(h1),
.chat-markdown :deep(h2),
.chat-markdown :deep(h3),
.chat-markdown :deep(h4),
.chat-markdown :deep(h5),
.chat-markdown :deep(h6) {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.chat-markdown :deep(h1) {
  font-size: 1.25rem;
}

.chat-markdown :deep(h2) {
  font-size: 1.125rem;
}

.chat-markdown :deep(h3) {
  font-size: 1rem;
}

.chat-markdown :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.chat-markdown :deep(strong) {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.chat-markdown :deep(ul) {
  list-style: disc;
  padding-left: 1.25rem;
}

.chat-markdown :deep(ol) {
  list-style: decimal;
  padding-left: 1.25rem;
}

.chat-markdown :deep(li + li),
.chat-markdown :deep(li > ul),
.chat-markdown :deep(li > ol) {
  margin-top: 0.25rem;
}

.chat-markdown :deep(li:has(> input[type='checkbox'])) {
  list-style: none;
}

.chat-markdown :deep(input[type='checkbox']) {
  margin-right: 0.375rem;
}

.chat-markdown :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  padding: 0.125rem 0.25rem;
  border-radius: calc(var(--ui-radius) * 0.75);
  background: var(--ui-bg-elevated);
}

.chat-markdown :deep(pre) {
  overflow-x: auto;
  padding: 0.75rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.chat-markdown :deep(pre code) {
  padding: 0;
  background: transparent;
}

.chat-markdown :deep(blockquote) {
  padding-left: 0.75rem;
  border-left: 3px solid var(--ui-border-accented);
  color: var(--ui-text-muted);
}

.chat-markdown :deep(hr) {
  border-color: var(--ui-border);
}

.chat-markdown :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}

.chat-markdown :deep(th),
.chat-markdown :deep(td) {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--ui-border);
  text-align: left;
}

.chat-markdown :deep(th) {
  background: var(--ui-bg-elevated);
  font-weight: 600;
}

.chat-markdown :deep(img) {
  max-width: 100%;
}
</style>
