import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { projectHomeCards, registerProjectHomeCard } from '../../app/utils/project-home'

const card = (name: string) => defineComponent({ name, render: () => null })

describe('project home cards', () => {
  it('keeps each slot\'s cards in registration order', () => {
    const first = card('first')
    const second = card('second')
    const elsewhere = card('elsewhere')
    registerProjectHomeCard('facts', { id: 'first', component: first })
    registerProjectHomeCard('aside', { id: 'elsewhere', component: elsewhere })
    registerProjectHomeCard('facts', { id: 'second', component: second })
    expect(projectHomeCards('facts').map(entry => [entry.id, entry.component])).toEqual([['first', first], ['second', second]])
    expect(projectHomeCards('aside').map(entry => entry.component)).toEqual([elsewhere])
  })

  it('replaces a card registered again under the same id, in its place', () => {
    const late = card('late')
    registerProjectHomeCard('main', { id: 'one', component: card('early') })
    registerProjectHomeCard('main', { id: 'two', component: card('other') })
    registerProjectHomeCard('main', { id: 'one', component: late })
    expect(projectHomeCards('main').map(entry => entry.id)).toEqual(['one', 'two'])
    expect(projectHomeCards('main')[0]?.component).toBe(late)
  })

  it('keeps an id separate per slot', () => {
    const top = card('top')
    const bottom = card('bottom')
    registerProjectHomeCard('facts', { id: 'twice', component: top })
    registerProjectHomeCard('aside', { id: 'twice', component: bottom })
    expect(projectHomeCards('facts').find(entry => entry.id === 'twice')?.component).toBe(top)
    expect(projectHomeCards('aside').find(entry => entry.id === 'twice')?.component).toBe(bottom)
  })
})
