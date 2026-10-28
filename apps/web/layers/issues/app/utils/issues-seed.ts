export const ISSUES_CREATE_THREAD_TITLE = 'Create an issue'

/** The first prompt of a "Create with an agent" thread; the thread runs in the project's checkout, where bd finds the tracker. */
export function issuesSeedCreatePrompt(projectName: string): string {
  const name = projectName.trim() || 'this project'
  return [
    `I want to add an issue to ${name}. Its issues are tracked with the bd (beads) CLI in the current directory.`,
    '',
    '1. Interview me briefly: ask what the issue is about, then only what you still need, such as the title, type (task, bug, feature, epic or chore), priority (P0 critical to P4 backlog), parent epic, acceptance criteria and what it depends on. Keep it to a few short questions, and look up existing issues with bd (bd list, bd show) rather than asking me for ids.',
    '2. If this project has a skill or guide for writing beads or issues, follow it. Otherwise write each issue so someone with no other context can do it: open with the problem and why it matters, say what to build without dictating how, state defaults and non-goals, and give acceptance criteria a person or a test can check.',
    '3. Create the issue with `bd create --json` in the current directory, using --type, --priority, --parent, --deps, --labels, --description and --acceptance as needed. If my answers describe several issues, create each one.',
    '4. Reply with the id of every issue you created.',
  ].join('\n')
}
