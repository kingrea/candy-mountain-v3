export default defineNuxtPlugin(() => {
  registerCorePanel('gadget', defineAsyncComponent(() => import('#layers/gadget/app/components/Panel.vue')))
})
