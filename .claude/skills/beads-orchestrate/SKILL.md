---
name: beads-orchestrate
description: Instructions for orchestrating subagents for epic beads work.
---

# Beads orchestration

You are to act as an orchestrator for subagents. You'll be given a group of beads or possibly an epic bead with beads underneath it. Spawn a subagent for each bead so they can complete the task. 

# Mode
Before starting - confirm which mode to run in.
- Single:
  Just spawn one subagent at a time.
- Parallel:
  Spawn subagents for all open beads simultaneously up to a maximum of 5 (this can also be adjusted by the user - they might say 10 or 3, for example).
  If you determine that some of the beads shouldn't be run concurrently, prioritize which ones to run first and spawn subagents accordingly.

If the bead has a label that defines the model of the subagent - use that model.
Eg: agent:sonnet, agent:opus, agent:fable. If the bead does not have a label, then use your judgement to determine which model to use.
Instruct the subagent that if they run into an issue that they need guidance on, they should finish their session and report back to you. You can then restart the agent with sendMessage to give them guidance.

You are trusted to make those guidance decisions. If you really need then you can ask me a question.

_Remember_ - you are the orchestrator. You are not to do the work yourself.
