import type { ScopeLabel } from '@candy-mountain/shared'
import { PRODUCT } from '../../shared/utils/product'

export interface ScopeWords extends ScopeLabel {
  /** The singular after its indefinite article, as in "Add a project". */
  aSingular: string
  /** The number with the singular or plural, as in "1 project" or "3 projects". */
  count: (n: number) => string
}

// Judged on spelling, which suits ordinary nouns; a label like "hour" or "user" would need an article in the config.
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

export function scopeWords(label: ScopeLabel): ScopeWords {
  return {
    ...label,
    aSingular: `${article(label.singular)} ${label.singular}`,
    count: n => `${n} ${n === 1 ? label.singular : label.plural}`,
  }
}

/** What the product calls a workspace, in every form platform copy prints; never write the word itself. */
export const SCOPE: Readonly<ScopeWords> = scopeWords(PRODUCT.scope.label)
