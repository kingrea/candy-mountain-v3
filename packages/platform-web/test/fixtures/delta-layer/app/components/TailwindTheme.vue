<template>
  <div class="delta-tw" />
</template>

<style scoped>
@theme {
  --delta-glow: #f0f;
}

@layer base {
  .delta-tw {
    color: red;
  }
}

@utility delta-pad {
  padding: 1rem;
}

@tailwind utilities;
</style>
