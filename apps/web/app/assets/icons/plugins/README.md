# Plugin brand icons

Downloaded from [SVGL](https://github.com/pheralb/svgl) on 2026-10-29 and
bundled locally so plugin views do not require third-party image requests.
SVG files are unmodified. Brand names and marks belong to their respective owners.
SVGL's MIT license is included in `LICENSE.txt`.

| Local file | Upstream asset |
| --- | --- |
| `netlify.svg` | [Netlify](https://github.com/pheralb/svgl/blob/main/static/library/netlify.svg) |
| `claude-code.svg` | [Claude](https://github.com/pheralb/svgl/blob/main/static/library/claude-ai-icon.svg) |
| `codex.svg` | [Codex](https://github.com/pheralb/svgl/blob/main/static/library/codex_light.svg) |
| `slack.svg` | [Slack](https://github.com/pheralb/svgl/blob/main/static/library/slack.svg) |
| `heroku.svg` | [Heroku](https://github.com/pheralb/svgl/blob/main/static/library/heroku.svg) |

`PluginsIcon.vue` renders these beside plugin names with decorative alt text.
The monochrome Codex mark is inverted in dark mode; Netlify and Heroku use a
white backing to keep their dark brand colors legible in either theme.
