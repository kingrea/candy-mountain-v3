<template>
  <div class="delta-deep" />
</template>

<style scoped>
:root {
  color: red;
}

html {
  color: red;
}

.delta-deep :deep(body) {
  color: red;
}

.dark .delta-deep {
  color: red;
}
</style>
