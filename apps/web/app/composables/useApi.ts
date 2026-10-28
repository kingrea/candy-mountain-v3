export const useApi = createUseFetch(() => ({ $fetch: useNuxtApp().$api as typeof $fetch }))
