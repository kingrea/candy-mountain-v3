import { isAdmin } from '@candy-mountain/shared'

export function useNavigation() {
  const { slug } = useNavigationProject()
  const { registry } = useProjectRegistry(slug)
  const { user } = useCurrentUser()

  const groups = computed(() => {
    const admin = registry.value?.admin ?? (user.value ? isAdmin(user.value) : false)
    return registryNavGroups(registry.value, slug.value, admin)
  })

  return {
    capabilityGroups: computed(() => groups.value.capabilityGroups),
    systemGroup: computed(() => groups.value.systemGroup),
  }
}
