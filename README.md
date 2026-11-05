# Special Projects Buzz plugins

Buzz desktop plugins for the team. Each folder is one plugin: a `manifest.json` and a `plugin.js`.

| Plugin | Folder | What it does |
|---|---|---|
| Sandbox Link | [`sandbox-link/`](sandbox-link/) | A live link for each channel. It starts a Vercel Sandbox dev server for a branch of reflect-orbital and pins the link above the composer. |

## Install

In Buzz, go to **Settings → Plugins → Manage plugins → Add**, choose to add from a repository, enter `SpecialProjects2050/buzz-plugins`, and pick the plugin. Each plugin's README covers its own setup.

## Developing

To develop a plugin, install it from a local checkout: **Add → Browse**, then pick the plugin's folder. Don't drag the folder in; Buzz copies a dropped folder, so it can't be reloaded.

Edit the files, then reload the plugin. A change to `manifest.host` needs the owner to approve an **Update** in Settings.
