<template>
  <div class="styled-tw" />
</template>

<style scoped>
@theme {
  --styled-glow: #f0f;
}

@layer base {
  .styled-tw {
    color: red;
  }
}

@utility styled-pad {
  padding: 1rem;
}

@tailwind utilities;
</style>
