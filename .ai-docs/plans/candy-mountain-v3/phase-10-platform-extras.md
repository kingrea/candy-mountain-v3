# Phase 10: Platform extras

**Capability:** The platform talks back: the Overview feed is useful, Slack tells me when things happen, and a platform agent can navigate the app for me.

## What and why

**Activity feed, complete.** By now sessions, runs, bot handoffs, incidents and deploys all write events. Give the Overview page filters by type, a time range, and links into the thing that happened. Add a cross-project view in the system group so a morning glance covers everything.

**Notifications.** A per-project notification rule set: when a bot finishes, when an incident opens or closes, when a deploy succeeds or fails, send a Slack direct message or channel post. Delivery uses the project's bot keys if a bot exists, otherwise a platform-level Slack plugin instance (the one place a global-scope plugin is needed in v3). Rules are simple on/off per event type with a destination.

**Platform chat agent.** Digital Hub's Hub agent, as a native Mastra agent: it knows the registry for the current actor and project and can open a view, start a chat with another agent, and describe what the platform can do. It is granted to every role. Jack will add the LLM gateway key and define the agent's model when he reaches this phase; until then the agent is declared in a manifest but hidden from the rail when no model is configured. This is the first native agent and the first use of Mastra beyond initialisation, so it also proves that path end to end: tool gating by rung, refusals returned as values, and memory threads in the platform database.

## Human test

Open the Overview feed for a busy project and filter to incidents only. Turn on "notify when a bot finishes" for a project and run a bot; receive the Slack message with a link to the thread. Add the gateway key, define the platform agent's model, and ask it to "open uptime for project X"; confirm the app navigates. Ask it to start a chat with Claude Code and confirm a new thread opens.
