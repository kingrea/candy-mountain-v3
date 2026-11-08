export default defineNuxtPlugin(() => {
  registerProjectHomeCard('facts', {
    id: 'zeta',
    component: defineAsyncComponent(() => import('#layers/zeta/app/components/Card.vue')),
  })
})
