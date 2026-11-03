import { markRaw, type Component } from 'vue'

/**
 * Named places on the project home where layers add cards: `facts` sits under the project's own facts, `aside` closes
 * the narrow column and `main` follows the activity feed.
 */
export const PROJECT_HOME_CARD_SLOTS = ['facts', 'aside', 'main'] as const

export type ProjectHomeCardSlot = (typeof PROJECT_HOME_CARD_SLOTS)[number]

/** A card a layer adds to the project home; it takes no props and reads the project with useSelectedProject(). */
export interface ProjectHomeCard {
  /** Unique within the slot, usually the contributing layer's id; registering it again replaces the earlier card. */
  id: string
  component: Component
}

const projectHomeCardsBySlot = new Map<ProjectHomeCardSlot, Map<string, ProjectHomeCard>>()

/**
 * Adds a card to a slot of the project home. Call it from the Nuxt plugin of the layer that owns the card, usually with
 * defineAsyncComponent so the card loads lazily; the page that renders the home never imports a contributing layer.
 * Cards in one slot render in registration order.
 */
export function registerProjectHomeCard(slot: ProjectHomeCardSlot, card: ProjectHomeCard): void {
  const cards = projectHomeCardsBySlot.get(slot) ?? new Map<string, ProjectHomeCard>()
  cards.set(card.id, { id: card.id, component: markRaw(card.component) })
  projectHomeCardsBySlot.set(slot, cards)
}

export function projectHomeCards(slot: ProjectHomeCardSlot): ProjectHomeCard[] {
  return [...(projectHomeCardsBySlot.get(slot)?.values() ?? [])]
}
