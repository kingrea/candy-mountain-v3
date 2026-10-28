import type { Issue, RegistryCapability, RegistryResponse } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  issuesAgentCreateOptions,
  issuesCanWrite,
  issuesCreateRequest,
  issuesPickerItems,
  type IssuesCreateFormData,
} from '../../app/utils/issue-create'

function capability(id: RegistryCapability['id'], overrides: Partial<RegistryCapability> = {}): RegistryCapability {
  return { id, label: id, rung: 'chat', chat: true, ready: true, reasons: [], modules: [], views: [], tools: [], ...overrides }
}

function registry(capabilities: RegistryCapability[]): RegistryResponse {
  return {
    project: { id: 'p1', slug: 'acme', name: 'Acme' },
    admin: true,
    modules: [],
    groups: [],
    views: [],
    agents: [],
    capabilities,
    degraded: [],
  }
}

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Title ${id}`,
    status: 'open',
    priority: 2,
    type: 'task',
    description: null,
    acceptanceCriteria: null,
    notes: null,
    assignee: null,
    owner: null,
    labels: [],
    parentId: null,
    createdAt: null,
    createdBy: null,
    updatedAt: null,
    startedAt: null,
    closedAt: null,
    closeReason: null,
    commentCount: 0,
    ready: true,
    dependencies: [],
    ...overrides,
  }
}

describe('issuesAgentCreateOptions', () => {
  it('offers nothing without a registry or without chat capabilities', () => {
    expect(issuesAgentCreateOptions(null)).toEqual([])
    expect(issuesAgentCreateOptions(registry([capability('issues', { rung: 'write', chat: false })]))).toEqual([])
  })

  it('offers each agent only when its chat capability is ready and chat is allowed', () => {
    const both = registry([capability('chat-claude-code'), capability('chat-codex')])
    expect(issuesAgentCreateOptions(both).map(option => option.agentId)).toEqual(['claude-code', 'codex'])

    const codexNotReady = registry([capability('chat-claude-code'), capability('chat-codex', { ready: false })])
    expect(issuesAgentCreateOptions(codexNotReady).map(option => option.agentId)).toEqual(['claude-code'])

    const claudeBelowChat = registry([capability('chat-claude-code', { rung: 'none', chat: false }), capability('chat-codex')])
    expect(issuesAgentCreateOptions(claudeBelowChat).map(option => option.family)).toEqual(['codex'])
  })
})

describe('issuesCanWrite', () => {
  it('needs the issues write tool', () => {
    expect(issuesCanWrite(null)).toBe(false)
    expect(issuesCanWrite(registry([capability('issues', { rung: 'read' })]))).toBe(false)
    expect(issuesCanWrite(registry([capability('issues', { rung: 'write', tools: ['issues.write', 'issues.comment'] })]))).toBe(true)
  })
})

describe('issuesPickerItems', () => {
  it('drops closed issues and orders the rest by id, numbers compared as numbers', () => {
    const items = issuesPickerItems([issue('cm-10'), issue('cm-2'), issue('cm-3', { status: 'closed' }), issue('cm-1.2')])
    expect(items.map(item => item.value)).toEqual(['cm-1.2', 'cm-2', 'cm-10'])
    expect(items[0]).toEqual({ label: 'Title cm-1.2', value: 'cm-1.2', description: 'cm-1.2' })
  })
})

describe('issuesCreateRequest', () => {
  const empty: IssuesCreateFormData = {
    title: '  Fix it  ',
    type: 'bug',
    priority: 1,
    labels: [],
    parentId: null,
    description: '  ',
    acceptanceCriteria: '',
    dependsOn: [],
  }

  it('sends only the title, type and priority when nothing else is filled in', () => {
    expect(issuesCreateRequest(empty)).toEqual({ title: 'Fix it', type: 'bug', priority: 1 })
  })

  it('sends every filled field, de-duplicating labels and dependencies', () => {
    expect(issuesCreateRequest({
      ...empty,
      labels: ['ui', ' ui ', 'api', ''],
      parentId: 'cm-1',
      description: ' Steps ',
      acceptanceCriteria: 'It works',
      dependsOn: ['cm-2', 'cm-3', 'cm-2'],
    })).toEqual({
      title: 'Fix it',
      type: 'bug',
      priority: 1,
      labels: ['ui', 'api'],
      parentId: 'cm-1',
      description: 'Steps',
      acceptanceCriteria: 'It works',
      dependsOn: ['cm-2', 'cm-3'],
    })
  })
})
