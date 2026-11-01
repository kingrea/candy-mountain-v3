# Phase 4: Home dashboard

**Capability:** A second product, built from the scaffold in its own repository, runs on the platform with a single workspace the user never sees, one capability of its own, and chat with a native agent. This is the proof that the base is a base.

## What and why

**Single-scope mode.** The home dashboard has one household. Add single-scope mode to the product configuration. The daemon creates the default workspace at first boot when none exists and refuses to create a second while the mode is on. The shell hides the picker and the projects page, auto-selects the one workspace, redirects the root into it, and never shows the scope label. Module enablement, grants, plugin instances and the gate keep working exactly as in multi-scope mode, because the workspace still exists under everything. The URL prefix stays; whether to mount scope-level pages at the root is decided after this phase, by looking at it.

**The product.** Create the home dashboard repository with the product scaffold: its own name and colour, auth with the password strategy, and the platform's standard pages. Build one capability for it with the capability scaffold: recipes, with a list and a detail page, its own table, and a workspace fact (has recipes) so the overview has something to show. It needs no plugin type. Keep the UI bare; the point is the platform, not the recipes.

**Chat with a native agent.** The home dashboard has no coding agents. Give the recipes capability a native Mastra agent through the platform's native family, with one tool that reads recipes, so the chat rail and panel work with no ACP capability installed. This exercises the chat contribution points the extraction plan separated from the ACP families, and it is the first use of the platform agent plumbing outside Candy Mountain. Jack adds the LLM gateway key; the capability declares the platform fact it needs.

**What this phase will find.** Expect the base to reveal assumptions: a platform page that still says "project", a composable that expects a picker, a registry field that assumes a git repository. Each one is a bug in the base, fixed there and released, not worked around in the product.

## Human test

Clone the home dashboard repo on a clean machine, install, start, log in, and land on the overview with no picker and no mention of projects or workspaces. Enable the recipes module, add a recipe, see it in the list and on the overview's fact. Open the chat rail, start a thread with the recipes agent and ask what is for dinner; it answers from the recipe table. Confirm the plugins page, grants page and settings all work. Then start Candy Mountain on the same base version and confirm it still shows its picker and projects unchanged.
