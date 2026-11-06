import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import { repositoryDefinition } from '@candy-mountain/cap-repository'
import { openTestDatabase, type PlatformDatabase, type Product, testProduct } from '@candy-mountain/platform-daemon'
import { issuesDefinition, type IssuesOptions } from './definition'

/** A module holding issues, so grants and enablement behave as they do under a product. */
export const ISSUES_TEST_MODULE: ModuleDefinition = { id: 'issues', label: 'Issues', description: 'The project\'s issues.', icon: 'i-lucide-list-todo', capabilities: [{ capabilityId: 'issues', defaultRung: 'write' }] }

export const issuesTestProduct = (options?: IssuesOptions): Product => testProduct({ capabilities: [repositoryDefinition(), issuesDefinition(options)], modules: [ISSUES_TEST_MODULE] })

export const openIssuesDatabase = (): PlatformDatabase => openTestDatabase({ definitions: [repositoryDefinition(), issuesDefinition()] })
