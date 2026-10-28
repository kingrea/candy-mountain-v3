# Phase 8: Operations: uptime

**Capability:** Per project, I can register things to ping, see their state and history, and get incidents when they go down.

## What and why

**Monitors are data.** Digital Hub's uptime kept monitors in a JSON file that needed a restart to change. In v3 monitors are rows owned by a project, created and edited from the Uptime page: a name, a source type, a target, and an interval. Source types start with a plain HTTP health check (expected status, optional response substring) and the vendor status-page kinds Digital Hub already reads (Statuspage, Status.io, Statping), with the type model open so more can be added as Jack meets them. The Uptime capability lives in the Operations module and needs no plugin.

**Polling.** The daemon schedules each monitor on its own interval, survives restarts without duplicate pollers, and stores each check (ok, status, latency, error). State is derived from recent history with the same hysteresis Digital Hub uses (down only after consecutive failures, degraded on a single failure or slow response) so a blip does not flap. An incident opens on the transition to down and closes on recovery, and both write to the project's activity feed. Keep room for an incident to carry an investigation thread later; nothing investigates automatically in v3.

**The page.** A card per monitor with its state, latency, and a history strip; a drawer with the recent checks and incidents; create and edit forms; a project-wide incident list. Refresh by polling the daemon or by a server-sent stream; either is fine, but keep the request count per tick small.

## Human test

Enable Operations on a project, add an HTTP monitor against a local fake service that can be toggled, and a Statuspage monitor against a public vendor. Watch both go green. Toggle the fake service off and confirm the card goes degraded then down, an incident opens, and the Overview feed shows it. Toggle it back on and confirm the incident closes. Restart the daemon and confirm history is intact, state is rebuilt without a false incident, and only one poller runs per monitor. Edit an interval and confirm the cadence changes without a restart.
