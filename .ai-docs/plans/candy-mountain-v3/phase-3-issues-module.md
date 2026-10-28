# Phase 3: Issues module

**Capability:** The beads viewer from v2, rebuilt in Nuxt UI as the Issues capability, with live refresh, editing, and comments. This is the page Jack uses every day, so it is the first thing that must feel finished.

## What and why

**Data path.** The daemon exposes dedicated issue endpoints per project that run `bd --json` in the project's checkout. Keep v2's rules: list with no limit so parent epics are never truncated, take readiness from `bd ready` and never from a list filter, and treat an unknown id as an error even though `bd` exits zero. Cache the list for a few seconds and watch the project's `.beads` directory so the page refreshes itself when `bd` is used from a terminal or by an agent. Bulk updates go through one endpoint rather than a client-side loop, and comment editing keeps v2's Dolt workaround until `bd` can edit comments. The Issues module needs no plugins; it is available for any project with `.beads`.

**The list.** Port v2's grouping exactly: top-level epics become collapsible groups with open and total counts, sub-epics nest recursively with indentation, issues whose parent is not an epic fall into a final ungrouped bucket, closed epics hide unless "show closed" is on. Sibling order is the hierarchical id sequence, then numeric-aware title order, then a topological pass over blocking dependencies. Rows carry everything v2 shows: priority flame, short uppercase id with the full id on hover and a copy action, title struck when closed, stage and research chips, status badge, type icon and colour, assignee, comment count. Add filters for ready and blocked, which v2 lacked, and a search over title and id. The v2 research notes list the exact components and colour maps; reproduce them with Nuxt UI primitives.

**Detail: slide-out and page.** Clicking a row opens a right-hand slide-out; the same detail component renders at an issue URL, so an id can be shared. The slide-out keeps a back stack so hopping through parent and dependency links does not lose the place. Detail shows title, status, type, priority, labels, assignee, parent, created and updated, close reason, and the description, acceptance criteria and notes rendered as markdown, plus depends-on, dependents and children lists. New in v3: title, description, acceptance criteria, notes, type, priority, labels, parent and assignee are editable in place, writing through `bd`. Comments list, add, and edit inline.

**Selection and bulk actions.** Checkboxes select rows; a floating bar shows the count and offers Run, add to epic, new epic (create then reparent), remove from epic, assign, change status, and clear. Run is present but disabled until Phase 5 lights it up; its tooltip says what is missing.

**Add issue.** A button opens a chooser: "Create with Claude Code" and "Create with Codex" appear only when the matching plugin is active for the project and route to a chat seeded with a drafting prompt (wired in Phase 5); "Write yourself" is a form with title, type, priority, optional labels, parent (pick from existing issues), description, acceptance criteria, and depends-on (pick several). Done creates the issue through `bd` and navigates to its page.

**Dependency view.** For an epic, a simple graph of its children and their blocking edges, using the dependency data already fetched. Keep it read-only and plain.

**Assignees.** v2 kept a per-project people list for the assignee picker. Keep a per-project list in the platform database and let the picker add a new name.

## Human test

Open a real project with a few hundred issues. Confirm grouping, nesting, counts and order match the v2 viewer on the same repo. From a terminal run `bd create` and `bd close` and watch the page update without a refresh. Open an issue, edit its title and priority, add a comment, edit the comment, and confirm each with `bd show`. Select five issues, move them under a new epic, and confirm with `bd list`. Create an issue with the form including a parent and two dependencies and confirm the page shows them. Open the dependency view for an epic.
