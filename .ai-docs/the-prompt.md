I would like to start working on a version 3 of my candy mountain application. I'd like to start with planning.

I'll be referencing 3 codebases for creating this version 3. 
Digital Hub (~/work/baby-bunting/digital-hub)
Clanker-corner (~/work/new-orange/clanker-corner)
Candy Mountain (version 2) (~/work/candy-mountain)

Candy Mountain is a codebase management platform. It's gone through a lot of iterations so far while i've been figuring out it's purpose. 
I've also been using the learnings i've had from it to build other client platforms (clanker-corner and digital hub). I think i'm ready to synthisise all of the things i've learned back into a new version of candy mountain.

So what will candy mountain be?
It is a codebase management platform. All of the codebases I work on use beads under the hood for issue tracking and management (some projects use other issue trackers externally, but I use beads internally for extrapolating plans and being able to run agent swarms over the work).
It runs locally (well, I start it up every day on it's dev server) and I use it's beads viewer to see what work is in progress, and to look through the bugs that have been reported, etc. 
At this point - this is all i'm using it for. 
V2 of Candy Mountain has a lot of extra things that I don't really use yet. Mainly because I haven't had the chance to finish building them or testing them. Also sometimes i've found that some of the things i've build aren't really fit for purpose. Which is why i'm looking at a fresh start.

I'd like to sort of 'merge' the work i've done on all three of these projects into my own personal helper.

I'd like some help discussing my options as well.

So what i'd like:

I would like the base of the application to be very similar to Digital Hub. 
In digital hub I have this idea of 'capabilities' - which are atomic parts of the application (chat, uptime, overview, etc). These capabilities are made in nuxt layers and they express a small group of views (pages), agents, composables, tools, etc. 
Capabilities are then grouped into 'modules' - a single capability can be in multiple different modules. 
Modules will be the high level grouping (eg: Codebase module has access to uptime monitors, overview, investigator chat).
I like this projects way of keeping each capability seperate (some capabilities are 'global' in that they are never granted to modules - but other capabilities can use them - eg: chat). 

If an agent has been granted to the user - then they can interact with it in the agent chat panel. Each of these agent will have scoped tools and wrapped MCP servers that they can access.

I want - as a foundation - to take on this architecture. I'll slowly build capabilities into the application. 
I don't nessesssarily want user roles yet - but I think it's a good idea to start building this with the idea that I will eventually have user roles. 
So lets just start with an 'admin' role. 

The thing that will be different for candy mountain from the digital hub is that we have different codebases linked to the application. With a picker - I can switch to a different codebase and see it's beads and interact with things to do with that codebase specifically. 

I think the best way of doing this would be to create the capabilities and modules, but then have to set them up on a per codebase basis. This will have to be through some sort of module / capability set up page we make. I'd like to keep this platform quite agnostic to what it's running as the codebases will all have different ways of running themselves, tests, capabilities, etc. 

Clanker corner:
This is a project that sort of 'side loads' the repo's it's connected to, and has management options for enabling claude code or codex agents to work on those repos. Connected in via slack app agents.
Each agent can be configured to connect to a codebase and those codebases need to have a claude/agent or .agents/agent file associated with that slack agent to get it's base instructions.

Codex has an oAuth flow that can be initated through slack, and is connected via ACP.
Claude code runs in  some sort of 'shim' that mimics ACP ( I think), it's oAuth flow can also be started via slack although it's slightly different.

So from a very high level:

Platform:
    selected-codebase (project):
        scoped modules:
            capabilities

        agent hub module

        plugins
        settings
        grants



Each module will need to have some associated plugins, these may be for things like MCP connections (like noibu, contentsquare in digital-hub), or may be for things like the digest in candy mountain (jira, slack). Generally speaking - multiple capabilities may share a plugin. So if it's been enabled and configured because of one capabilitiy - then it doens't need to be reconfigured when another capability that shares it is added.

## Modules

### Agent Hub

This will basically be what we've creataed in clanker-corner. 

#### Capabilities:

- Plugin: Repository
    When the project is set up - it can just be pointed at a folder on a computer.
    But this section will need a repo attached.
    There can only be one repo attached per 'project'.
    The Repository plugin can support:
        Github
        Bitbucket

    The user should be able to put in the scoped API keys needed for it (check out clanker-corner for how thats set up)

- Plugin: Claude Code
    This is the oAuth to setup claude code to be working in this project (see how in clanker-corner)

- Plugin: Codex
    This controls the oAuth and setup of codex. 

- Page: Bots (requires repo plugin to be set up before editing, and codex OR claude code configured). 
    This page is used to set up and connect bots.
    Creating a new bot, or editing an existing one.
    Setup should be similar to clanker-corner.
    Enter the bots two keys for slack
    Can choose between claude code and codex
    Scope: Read-only, Write (Auto), Write (Confirmation prompts)
    (don't need the approvals section)

    It doesn't need the 'repositories' step since the repo is already selected based on the one the user is in.
    However, the options in there that are needed should be folded into the setup:
    base branch (don't worry about keyword or slack team ID),
    Answers in: Anywhere | Selected channels 
        selcted channels should bring up an input (one channel per input) and a + sign to add another input to fill in. 
    There should be a persona check button that looks in the base branch provided for
    .agents/agents/<name> or .claude/agents/<name> - depending on which ones are available the option of claude and codex should be be disabled if one of these doesn't exist. 

    Each agent card should show it's status (active, not configured, warnings)

- Page: Team (requires repo plugin to be set up, and at least one bot configured)
    Like clanker corner - any one specified in here is able to talk to the bot.
    Unlike clanker corner - they dont' need to log into claude/codex. That only happens once in setup. It will just use the claude/codex account that is configured in the plugin.
    Add a team member: Name, Email and Slack member id

- Agent chat with Claude Code session (requires claude code plugin to be active)

- Agent chat with Codex session (requires codex to be active)

- Agent chat with specified bot (bot must be configured and it's ai model active)

### Issues (issue tracker)

- Plugin: Claude code
- Plugin: Codex
- Plugin: Repository
(these are optional)
Page: Issues
This will practically be a clone of the beads page in Candy mountain. The UI works really well and i'm happy with it.
It should group issues by epic.
Issue sub epics should nest.
Copy all the metadata from the current beads viewer.
Clicking on an entrance should give the overview slide out.
Or clicking on the page for the bead beads/<id> equivilent should show the same info.

Selecting multiple beads should bring up the multi-select menu like in beads page.
Run button is enabled if repo is set up and claude code or codex is active.
It will open agent chat window to run selected beads.

Add Issue button on this page:
    Should bring up in a modal:
        Create with Claude (if enabled),
        Create with Codex (if enabled), 
        Write yourself.
    Selecting either of the first two will bring up the respective chat window.
    Write yourself should be a form:
    Title, type, priority, optional labels,
    select parent (can select other issue),
    description,
    Acceptance critera,
    Depends on (select other issue(s))
    Then clicking done will create it with bd command thats generated from the form data. Should go to the issue page.
Page: Issues/:id & Overview slide out
Should have all the info currently on the beads page.
Should be able to add comments.

If claude code or codex is enabled && repo is setup, then:
The individual bead should have a run button.
Selecting it should let you choose from claude code or codex.
It would then open an agent chat window with the prompt to run that bead id.

**Note** refer to these as issues - not beads. It's powered by beads under the hood but on the frontend we will call them issues.

### Operations

Plugin: Repository

Plugin: Netlify
    Sets up netlify connection

Plugin: Heroku
    Sets up heroku connection

Page: Uptime
    - Can configure multiple sources to ping.
    - Source url
    - How often
    Might need to have a source type in here I know there are different ones and they'll have to be built out as they go.
    See digital-hub project for it's uptime viewer page and how it's set up.

Page: Deployments
    - Current live version (will need to be set up, some sort of endpoint in the projects that returns the information needed. Will have to be structured or a structure needs to be defined here)
    - A deployment zone that lets you select a branch and an environment and 'Deploy'.
    This zone will only take specific vendors that i'll set up and need to be configured.
    For now it will be:
        Netlify,
        Bitbucket,
        Github,
        Heroku.
    Since there are lots of ways to kick off a deploy (some may be on push to specific branch already, i'll have to do a lot of work in this area to cover the cases i'm using it for. So keep this part a little bit open ended.)



# project technology
In terms of what it's built on - it's a bit of an open question for me at the moment.

I've normally built apps with Nuxt, Vue, Nuxt UI (or shadcn-vue), some sort of tailwind framework. I also use pnpm for my projects.
However... 

I would eventually like to turn this into a desktop app. 
I'd like to be able to start it as an application (not running pnpm dev in vs code to have it running in the background).

I'd like to be able to do the vs code thing, but i'd also love to somehow get it running as a native application.
I've never really done that before. So i'm open to some recommendations here.

I'm also open to the tech it's built on. I've been using mastra for all of my agent setup stuff. But i'm open to other systems for that. 

Eventually - far down the path, I could also make an andriod app to interface with this.

Realistically i'll be interfacing with it via a browser for the most part.
I'm going to start by having it locally on my computer.
Then (when i get my home server up and running) - i'll have it live on my server and i'll access it through my tailscale network or local network.

There might be a time that I would like to host it fully online, somewhere like exe.dev

There is also an open question about how the repos are stored. Currently with everything above - the repos aren't really 'run'. They are just used and edited statically. I'm sure an agent (like claude code session) could run the tests or build it etc and it would just run on my computer. 

But if we could explore choosing a source for the project that is non-local? I did try this in candy mountain with the docker container as an option. But I never really commited to it and never really ended up hosting this anywhere.

This could also be a plugin option now that I think about it? I don't know. I'm open to things in this area and recommendations.

Once we've figured this all out, i'd like to make an implementation plan. Even if some sections (like deployment hub) are loose and in a tbd state and we focus in on that at a later date i'm fine with that.

So lets chat and figure it out. COuld you take a look at those repos (feel free to use sub agents here), and grill me on anything i'm missing or doesn't seem clear. Or a feature that could be a good addition? 