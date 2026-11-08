<template>
  <div class="delta-wide" />
</template>

<style scoped>
.delta-wide :global(.alpha-card) {
  color: red;
}

.delta-wide ::v-global(.alpha-card) {
  color: blue;
}
</style>
