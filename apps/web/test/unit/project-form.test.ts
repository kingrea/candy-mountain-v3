import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Workspace } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import * as z from 'zod'
import {
  projectFormAfterSave,
  projectFormDescription,
  projectFormErrorField,
  projectFormFields,
  projectFormInitial,
  projectFormRequest,
  projectFormSchema,
  registerProjectFormField,
} from '../../app/utils/project-form'
import { PROJECT_ROW_SLOTS, projectRowActions, projectRowItems, registerProjectRowAction, registerProjectRowItem } from '../../app/utils/project-list'

const base = z.object({ name: z.string().min(1) })
const project = { id: 'p1', slug: 'app', name: 'App' } as Workspace
const component = defineComponent({ name: 'field', render: () => null })

// Each test file gets fresh modules, so the registries start empty here.
describe('the project form and row with nothing contributed', () => {
  it('render only core\'s own fields, request and copy', async () => {
    expect(projectFormFields()).toEqual([])
    expect(projectFormSchema(base).parse({ name: 'App', path: '/srv/app' })).toEqual({ name: 'App' })
    expect(projectFormInitial(null)).toEqual({})
    expect(projectFormRequest({ name: 'App' }, null)).toEqual({})
    expect(projectFormErrorField('invalid_path')).toBeUndefined()
    expect(projectFormDescription(false)).toBeUndefined()
    expect(projectFormDescription(true)).toBeUndefined()
    expect(await projectFormAfterSave(project, { name: 'App' }, true)).toEqual([])
  })

  it('render rows with no extra detail and only core\'s actions', () => {
    for (const slot of PROJECT_ROW_SLOTS) expect(projectRowItems(slot)).toEqual([])
    expect(projectRowActions()).toEqual([])
  })
})

describe('contributed project form fields', () => {
  it('extend the schema, state, request, error mapping, copy and after-save notes', async () => {
    const seen: unknown[] = []
    registerProjectFormField<string>({
      name: 'extra',
      component,
      schema: z.string().min(2, 'Too short'),
      initial: saved => saved?.slug ?? '',
      request: (value, saved) => ({ color: `${value}:${saved?.slug ?? 'new'}` }),
      errorCodes: ['extra_bad'],
      afterSave: (saved, context) => {
        seen.push([saved.slug, context])
        return { description: 'Extra saved.', color: 'warning' }
      },
      description: { create: 'Create it.', edit: 'Edit it.' },
    })
    registerProjectFormField<boolean>({ name: 'flag', component, schema: z.boolean(), initial: () => false })

    const schema = projectFormSchema(base)
    expect(schema.parse({ name: 'App', extra: 'xy', flag: true, other: 1 })).toEqual({ name: 'App', extra: 'xy', flag: true })
    expect(schema.safeParse({ name: 'App', extra: 'x', flag: false }).success).toBe(false)
    expect(schema.safeParse({ name: 'App', extra: 'xy', flag: false }).success).toBe(true)
    expect(projectFormInitial(project)).toEqual({ extra: 'app', flag: false })
    expect(projectFormRequest({ extra: 'v' }, null)).toEqual({ color: 'v:new' })
    expect(projectFormRequest({ extra: 'v' }, project)).toEqual({ color: 'v:app' })
    expect(projectFormErrorField('extra_bad')).toBe('extra')
    expect(projectFormErrorField('other')).toBeUndefined()
    expect(projectFormDescription(false)).toBe('Create it.')
    expect(projectFormDescription(true)).toBe('Edit it.')
    expect(await projectFormAfterSave(project, { extra: 'v', flag: true }, false)).toEqual([{ description: 'Extra saved.', color: 'warning' }])
    expect(seen).toEqual([['app', { value: 'v', created: false }]])
  })

  it('replace a field registered again under the same name, in its place', () => {
    registerProjectFormField<string>({ name: 'extra', component, schema: z.string(), initial: () => 'again' })
    expect(projectFormFields().map(field => field.name)).toEqual(['extra', 'flag'])
    expect(projectFormInitial(null)).toEqual({ extra: 'again', flag: false })
  })
})

describe('contributed project row items and actions', () => {
  it('keep each slot\'s items and the actions in registration order', async () => {
    registerProjectRowItem('detail', { id: 'a', component })
    registerProjectRowItem('badges', { id: 'b', component })
    registerProjectRowItem('detail', { id: 'c', component })
    expect(projectRowItems('detail').map(item => item.id)).toEqual(['a', 'c'])
    expect(projectRowItems('badges').map(item => item.id)).toEqual(['b'])

    registerProjectRowAction({ id: 'x', label: 'Do it', icon: 'i-lucide-zap', run: async saved => ({ title: `Did ${saved.name}` }) })
    expect(projectRowActions().map(action => action.label)).toEqual(['Do it'])
    expect(await projectRowActions()[0]?.run(project)).toEqual({ title: 'Did App' })
  })
})

const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const REPOSITORY_WORDS = /source\.path|PathVerification|\bverification\b|verify-path|\/verify\b|pathExists|hasBeads|isGitRepo|hasRemote|remoteName|remoteUrl/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

// The repository layer contributes the path and its facts; core never reads them.
describe('core', () => {
  it('names no repository source, path check or verification fact', () => {
    const found = ['app', 'server', 'shared'].flatMap(dir => sourceFiles(join(webRoot, dir))).flatMap(file =>
      readFileSync(file, 'utf8').split('\n').flatMap((line, index) =>
        REPOSITORY_WORDS.test(line) ? [`${relative(webRoot, file)}:${index + 1}: ${line.trim()}`] : []))
    expect(found).toEqual([])
  })
})
