# Sandbox Link (Buzz plugin)

Gives each channel its own live link. You choose a **project folder** and a **branch** for the channel. The plugin starts a
Vercel Sandbox running that branch's dev server and pins **● Live link ↗** above the composer.
Teammates can open the link without a deploy.

The plugin works with any repo. It doesn't hold the sandbox logic itself. Each project supplies a
`scripts/sandbox/link.mjs` script (contract below), and the plugin runs it.
`SpecialProjects2050/reflect-orbital` has the reference implementation (PR #89).

## Install

Settings → Plugins → Manage plugins → **Add** → from repository → `SpecialProjects2050/buzz-plugins`,
then pick **Sandbox Link**. Review the access: it runs one `zsh` command that calls the project's `link.mjs`.

## Per-person setup

- **Vercel:** be a member of the Vercel team that owns the project, and run `vercel login`.
- **GitHub:** run `gh auth login`, with read access to the project's repo.
- **Secrets:** the project's own secrets for its env script, for example the sops age key at `~/.config/sops/age/keys.txt`.
- **Tools:** Node 22+ and pnpm on your login shell's PATH (`zsh -l`).
- **Checkout:** a local checkout of the project with `pnpm install` done.

## Using it

1. In a channel, click 🔗 in the header.
2. Set **Project folder** (for example `~/.buzz/REPOS/reflect-orbital`) and **Branch**. Each channel remembers both. A new channel starts with the last folder you used.
3. Click **Start**, or **Start live link** above the composer.

| Where | What |
|---|---|
| Pill above the composer | **Start live link** (grey), then **Starting…** (amber), then **Live link ↗** (green), which opens the site. Red means it failed; hover to see why. |
| 🔗 in the channel header | Status, the URL with a Copy button, folder, branch, **Pull latest** / **Stop**, and the log |

After you push, click **Pull latest**: the sandbox pulls and the page hot-reloads. Click **Stop** when you're done.

## Adding a project: the `link.mjs` contract

Put `scripts/sandbox/link.mjs` in the repo. The plugin runs it from the repo root as
`node scripts/sandbox/link.mjs <cmd> --json [--branch <name>]`.

Commands: `up` (create or resume, then start the dev server), `sync` (git pull inside the sandbox), `status` (read-only;
must not resume a stopped sandbox), `stop`.

With `--json`, the **last stdout line** must be one JSON object:

```json
{"branch":"main","name":"proj-main","url":"https://sb-….vercel.run","state":"running","region":"syd1"}
```

`state` is one of:

- `running`: the dev server answers.
- `stopped`
- `none`
- `error`: include an `"error"` message.

Send progress to stderr; the plugin shows it in the log. A missing `--branch` means the checkout's current branch.

To start from the reflect-orbital version, copy it and change the Vercel team and project IDs, the env
step (`pull-env.sh`), the install command and the dev command/port.

## For agents

The plugin gives agents running on the same Buzz app three tools, so the agent doing the work decides what the channel's live link shows:

- `sandbox_link_start(folder, branch)` points the channel's link at that checkout and branch, starts the sandbox and begins mirroring saves. It returns the URL.
- `sandbox_link_status()` is read-only.
- `sandbox_link_stop()`

Once the link is started, every file saved in the folder is copied into the sandbox, so refreshing the link shows the change with no commit or push needed. This mirroring needs the project's `link.mjs` to support `watch`.

## Known limits

- The sandbox holds the starter's personal secrets and GitHub token (in reflect-orbital's implementation).
- A live URL is open to anyone who has it.
- Buzz doesn't pass clicks on a channel-header icon to the plugin, so the header 🔗 always opens the panel.
