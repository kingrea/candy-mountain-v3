export { REPOSITORY_PATHS, REPOSITORY_WORKSPACE_FACTS, repositoryDefinition } from './definition'
export { RepositoryError } from './errors'
export { repositoryRoutes } from './routes'
export * from './service'
export { normaliseRepositoryPath, verifyPath } from './verification'
export * from './plugin-type'
export * from './wire'

// Test support, kept free of vitest so the root entry stays safe to bundle.
export { createWorkspaceWithRepository, type CreateWorkspaceWithRepositoryInput } from './test-support'
export { fakeHosts, GOOD_TOKEN, json as hostJson, type FakeHandler, type RecordedRequest } from './plugin-type/fake-hosts'
