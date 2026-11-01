# Plugin brand icons

Downloaded from [SVGL](https://github.com/pheralb/svgl) on 2026-10-29 and
bundled locally so plugin views do not require third-party image requests.
SVG files are unmodified. Brand names and marks belong to their respective owners.
SVGL's MIT license is included in `LICENSE.txt`.

| Local file | Upstream asset |
| --- | --- |
| `netlify.svg` | [Netlify](https://github.com/pheralb/svgl/blob/main/static/library/netlify.svg) |
| `heroku.svg` | [Heroku](https://github.com/pheralb/svgl/blob/main/static/library/heroku.svg) |

The layer's Nuxt plugin registers them with `registerPluginIcon`; core's `PluginsIcon`
renders each beside plugin names with decorative alt text.
Netlify and Heroku use a white backing to keep their dark brand colors legible in either theme.
