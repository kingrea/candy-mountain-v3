export default defineNuxtPlugin(() => {
  registerProjectHomeCard('aside', {
    id: 'template',
    component: defineAsyncComponent(() => import('#layers/template/app/components/Card.vue')),
  })
})
