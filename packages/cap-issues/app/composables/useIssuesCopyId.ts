export function useIssuesCopyId() {
  const toast = useToast()

  return async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(id)
      toast.add({ title: 'Issue id copied', description: id, icon: 'i-lucide-check' })
    }
    catch {
      toast.add({ title: 'Could not copy the id', color: 'error' })
    }
  }
}
