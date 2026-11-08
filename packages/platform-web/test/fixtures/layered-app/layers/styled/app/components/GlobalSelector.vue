<template>
  <div class="styled-wide" />
</template>

<style scoped>
.styled-wide :global(.alpha-card) {
  color: red;
}

.styled-wide ::v-global(.alpha-card) {
  color: blue;
}
</style>
