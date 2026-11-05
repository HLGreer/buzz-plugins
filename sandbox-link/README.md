# Sandbox Link (Buzz plugin)

A live link per channel for `reflect-orbital`. Each channel picks a branch. The plugin starts a
Vercel Sandbox running `astro dev` on that branch and pins **● Live link ↗** above the composer.
Teammates can open the link without a deploy.

It's a thin UI over `scripts/sandbox/link.mjs` in the reflect-orbital repo (PR #89). All the
sandbox logic lives there.

## Setup (about 10 minutes, once per person)

1. **Accounts**
   - You're a member of the `special-projects-2050` Vercel team. Run `vercel login`.
   - Run `gh auth login`. You need read access to `SpecialProjects2050/reflect-orbital`.
   - The age key you already use for `./pull-env.sh` is at `~/.config/sops/age/keys.txt`.
2. **Tools:** Node 22+ and pnpm on your login shell's PATH (`zsh -l`).
3. **Checkout:** clone reflect-orbital, check out `main` (it needs `scripts/sandbox/link.mjs`), then run `pnpm install`.
   The default location is `~/.buzz/REPOS/reflect-orbital`. Any folder works; you set it in step 5.
4. **Install the plugin:** in Buzz, go to Settings → Plugins → Manage plugins → **Add** → from repository →
   `SpecialProjects2050/buzz-plugins`, then pick **Sandbox Link** (folder `sandbox-link/`). Review the access. It runs one `zsh` command that calls `link.mjs`.
5. **Use it:** in a channel, click the 🔗 in the header.
   - Set **Branch**. Each channel remembers its own.
   - Set **reflect-orbital folder** if your checkout isn't at the default location.
   - Click **Start**, or click **Start live link** above the composer.

## Using it

| Where | What |
|---|---|
| Pill above the composer | Grey **Start live link**, then amber **Starting…**, then green **Live link ↗**, which opens the site. Red means it failed; hover to see why. |
| 🔗 in the channel header | Panel with status, the URL and Copy, Branch, folder, **Pull latest** / **Stop**, and the log |

- After you push, click **Pull latest**. The sandbox pulls and the page hot-reloads.
- **Stop** when you're done. A stopped link costs about $0.15/month. A running one costs about $0.10/hour, and a session ends on its own after 24 hours.
- Sandboxes are created near whoever starts them. Override with `SANDBOX_REGION`.

## Known limits

- The sandbox gets the starter's personal age key and GitHub token. A dedicated key and token are still to do.
- The live URL is open to anyone who has it. The Stage gate still applies.
- Buzz doesn't pass clicks on a channel-header icon to the plugin, so the header 🔗 always opens the panel.
