export const PAGE_SIZE = 10

export function formatRow(row: string) {
  return row.trim()
}

export function useBetaRows() {
  return [formatRow(' a ')].slice(0, PAGE_SIZE)
}
