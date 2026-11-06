import { describe, expect, it } from 'vitest'
import { issuesSeedCreatePrompt } from '../../app/utils/issues-seed'

describe('issuesSeedCreatePrompt', () => {
  it('names the project and asks for a brief interview before creating with bd in the current directory', () => {
    const prompt = issuesSeedCreatePrompt('Acme')

    expect(prompt).toContain('add an issue to Acme')
    expect(prompt).toMatch(/Interview me briefly/)
    expect(prompt).toContain('`bd create --json` in the current directory')
    expect(prompt).toContain('Reply with the id of every issue you created')
  })

  it('defers to the project\'s own issue-writing skill before the inline standard', () => {
    const prompt = issuesSeedCreatePrompt('Acme')

    expect(prompt.indexOf('skill or guide for writing beads or issues')).toBeLessThan(prompt.indexOf('acceptance criteria a person or a test can check'))
  })

  it('falls back to a generic name when the project has none', () => {
    expect(issuesSeedCreatePrompt('  ')).toContain('add an issue to this project.')
  })
})
