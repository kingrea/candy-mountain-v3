<template>
  <div class="styled-deep" />
</template>

<style scoped>
:root {
  color: red;
}

html {
  color: red;
}

.styled-deep :deep(body) {
  color: red;
}

.dark .styled-deep {
  color: red;
}
</style>
