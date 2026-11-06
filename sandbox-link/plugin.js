export const inject = ["react", "panels", "host", "conversation", "agents"];

// Per channel: a project folder + branch -> a Vercel Sandbox dev server, via that project's
// scripts/sandbox/link.mjs (the contract is in README.md). Works with any repo that ships it.
export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;

  // Repo folder + per-channel branch persist in localStorage (no KV API in plugins).
  const LS = "specialprojects.sandbox-link:";
  const lsGet = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(LS + k, v) : localStorage.removeItem(LS + k); } catch {} };
  // Last folder anyone picked: the default for a channel that hasn't chosen one yet.
  let lastFolder = lsGet("folder", "");

  // ---- per-channel store -------------------------------------------------------------
  const blank = (key) => ({ status: "idle", url: null, folder: lsGet("folder:" + key, ""), branch: lsGet("branch:" + key, ""), log: [], error: null, info: null, proc: null });
  const stores = new Map(); // channelKey -> state
  const subs = new Set();
  const get = (key) => { if (!stores.has(key)) stores.set(key, blank(key)); return stores.get(key); };
  const set = (key, patch) => { stores.set(key, { ...get(key), ...patch }); subs.forEach((f) => f()); };
  const useStore = (key) => {
    const [, force] = React.useReducer((n) => n + 1, 0);
    React.useEffect(() => { subs.add(force); return () => subs.delete(force); }, []);
    return get(key);
  };

  ctx.effect(() => () => { for (const s of stores.values()) { try { s.proc && s.proc.kill(); } catch {} } });

  // Whatever the host hands us that identifies the channel. Fallback: the last channel whose
  // header rendered, then "default".
  let lastKey = "default";
  const keyOf = (props, target) => {
    const c = (props && (props.channelContext || props.context)) || props || {};
    const k = c.channelId || c.channel_id || (c.channel && (c.channel.id || c.channel)) || c.id || props.channelId;
    if (typeof k === "string" && k) return k;
    if (typeof target === "string" && target.startsWith("sandbox-link:") && target.length > 13) return target.slice(13);
    return lastKey;
  };

  const lastJson = (lines) => {
    for (let i = lines.length - 1; i >= 0; i--) { try { const o = JSON.parse(lines[i]); if (o && typeof o === "object") return o; } catch {} }
    return null;
  };
  const fromInfo = (info) => ({
    info,
    url: info && info.state === "running" ? info.url : null,
    status: info && info.state === "running" ? "live" : "idle",
  });


  // Runs link.mjs <cmd> --json for one channel. Quiet mode (status polls) leaves log/error alone.
  // Resolves { info, error } when the command finishes (agent tools await it; UI ignores it).
  function run(key, cmd, { quiet = false } = {}) {
    let resolveRun;
    const result = new Promise((r) => { resolveRun = r; });
    const s = get(key);
    if (!ctx.host.spawn) { const error = "Process spawning isn't available in this Buzz build."; if (!quiet) set(key, { status: "error", error }); return Promise.resolve({ error }); }
    if (s.proc) {
      // A background status check must never block a click: cancel it and go.
      if (s.procQuiet && !quiet) { try { s.proc.kill(); } catch {} s.procCancel && s.procCancel(); }
      else return Promise.resolve({ error: "busy: another command is still running for this channel" });
    }
    const folder = (s.folder || lastFolder).trim();
    if (!folder) { const error = "Pick this channel's project folder in the 🔗 panel first."; if (!quiet) set(key, { status: "error", error }); return Promise.resolve({ error }); }
    const args = [cmd, "--json"];
    if (s.branch.trim()) args.push("--branch", s.branch.trim());
    const out = [];
    let buf = "";
    let done = false;
    let timer = null;
    const pushLog = (chunk) => {
      const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length) set(key, { log: [...get(key).log, ...lines].slice(-200) });
    };
    // Finish on the JSON result line itself. Buzz's `exited` can settle before the output
    // arrives, so it is only used to report a real non-zero exit.
    const finish = (info, err) => {
      if (done) return; done = true;
      clearTimeout(timer);
      if (!quiet && info && info.state === "running" && (cmd === "up" || cmd === "start")) startWatch(key);
      if (cmd === "stop" || cmd === "rm") stopWatch(key);
      resolveRun(info && info.state !== "error" ? { info } : { info, error: (info && info.error) || err });
      set(key, { proc: null, procQuiet: false, procCancel: null });
      if (info && info.state === "error") {
        set(key, quiet ? { status: get(key).url ? "live" : "idle" } : { status: "error", error: info.error || "link.mjs failed — see log." });
      } else if (info) {
        if (cmd === "stop" || cmd === "rm") set(key, { ...fromInfo(null), info: { ...info, state: "stopped" } });
        else if (info.state) set(key, fromInfo(info));
        else set(key, { status: get(key).url ? "live" : "idle" });
        if (cmd === "up" && info.state !== "running") set(key, { status: "error", error: "up finished but the dev server isn't answering — see log." });
      } else if (!quiet) set(key, { status: "error", error: err });
      else set(key, { status: get(key).url ? "live" : "idle" });
    };
    const onStdout = (chunk) => {
      buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const parts = buf.split(/\r?\n/); buf = parts.pop();
      const lines = parts.filter(Boolean);
      out.push(...lines);
      if (!quiet) pushLog(lines.join("\n"));
      const info = lastJson(lines);
      if (info && info.state) finish(info);
    };
    const onStderr = quiet ? undefined : pushLog;
    if (!quiet) set(key, { status: cmd === "up" ? "starting" : cmd === "stop" ? "stopping" : "working", error: null, log: [`$ link.mjs ${args.join(" ")}`] });
    // Cancelling a superseded quiet check: mark it done without touching state.
    const cancel = () => { done = true; clearTimeout(timer); resolveRun({ error: "cancelled" }); };
    set(key, { proc: { kill() {} }, procQuiet: quiet, procCancel: cancel });
    // `up` on a brand-new branch can take ~3 min; give it 6. A status check gets 30 s.
    const limit = quiet ? 30 * 1000 : 6 * 60 * 1000;
    timer = setTimeout(() => finish(lastJson(out), `link.mjs ${cmd} gave no result after ${quiet ? "30 s" : "6 min"} — see log.`), limit);
    Promise.resolve()
      .then(() => ctx.host.spawn("link", { args: [folder, ...args], onStdout, onStderr }))
      .then((p) => {
        if (!done && p) set(key, { proc: p });
        else if (done && p && quiet) { try { p.kill(); } catch {} }
        const ex = p && p.exited;
        return typeof ex === "function" ? ex.call(p) : ex;
      })
      .then((res) => {
        const code = res && typeof res === "object" ? (res.code ?? res.exitCode ?? res.status) : res;
        if (typeof code === "number" && code !== 0) {
          // let any trailing output land first
          setTimeout(() => { if (buf) out.push(buf); finish(lastJson(out), `link.mjs ${cmd} exited with ${code} — see log.`); }, 500);
        }
      }, (e) => finish(null, String((e && e.message) || e)));
    return result;
  }

  // ---- watcher: mirrors every local save into the sandbox (link.mjs watch) -------------
  // One long-running process per channel, started after a successful Start and killed on
  // Stop, plugin reload or app quit. Its output goes to the channel's log.
  const watchers = new Map();
  function stopWatch(key) { const w = watchers.get(key); if (w) { try { w.kill(); } catch {} watchers.delete(key); set(key, { watching: false }); } }
  function startWatch(key) {
    if (!ctx.host.spawn || watchers.has(key)) return;
    const s = get(key); const folder = (s.folder || lastFolder).trim(); if (!folder) return;
    const args = ["watch"]; if (s.branch.trim()) args.push("--branch", s.branch.trim());
    const onLine = (chunk) => {
      const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("{"));
      if (lines.length) set(key, { log: [...get(key).log, ...lines].slice(-200) });
    };
    const placeholder = { kill() {} };
    watchers.set(key, placeholder);
    set(key, { watching: true });
    Promise.resolve().then(() => ctx.host.spawn("link", { args: [folder, ...args], onStdout: onLine, onStderr: onLine }))
      .then((p) => {
        if (watchers.get(key) !== placeholder) { try { p.kill(); } catch {} return; }
        watchers.set(key, p);
      }, (e) => { watchers.delete(key); set(key, { watching: false, log: [...get(key).log, "watch failed: " + String((e && e.message) || e)] }); });
  }
  ctx.effect(() => () => { for (const k of [...watchers.keys()]) stopWatch(k); });

  const ICON =
    "data:image/svg+xml;utf8," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-4 -3 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>');

  // Channel-header button. Polls status for its own channel while mounted.
  function Launcher(props) {
    const key = keyOf(props);
    lastKey = key;
    const s = useStore(key);
    React.useEffect(() => {
      run(key, "status", { quiet: true });
      const t = setInterval(() => { const c = get(key); if (!c.proc && c.status !== "error") run(key, "status", { quiet: true }); }, 60000);
      return () => clearInterval(t);
    }, [key]);
    const dot = { live: "#22c55e", starting: "#f59e0b", working: "#f59e0b", stopping: "#f59e0b", error: "#ef4444" }[s.status];
    // When live, clicking the header icon opens the live link directly (the panel is still
    // reachable from the top-bar 🔗). Otherwise the click falls through and opens the panel.
    const openLink = (e) => {
      if (!s.url) return;
      e.preventDefault(); e.stopPropagation();
      window.open(s.url, "_blank", "noopener");
    };
    const title = s.url ? `Open live link: ${s.url}` : `Sandbox link${s.info ? " (" + s.info.state + ")" : ""}`;
    return h(s.url ? "a" : "span", {
      title, href: s.url || undefined, target: s.url ? "_blank" : undefined, rel: s.url ? "noreferrer" : undefined,
      onClick: openLink, onPointerDown: s.url ? (e) => e.stopPropagation() : undefined,
      style: { display: "inline-flex", alignItems: "center", alignSelf: "center", verticalAlign: "middle", color: "inherit", cursor: "pointer" },
    },
      h("span", { style: { position: "relative", display: "block", width: 16, height: 16 } },
        h("img", { src: ICON, alt: "Sandbox link", width: 16, height: 16, style: { display: "block", filter: "var(--icon-filter, none)" } }),
        dot ? h("span", { style: { position: "absolute", top: -4, right: -6, width: 6, height: 6, borderRadius: 9, background: dot, pointerEvents: "none" } }) : null));
  }

  function Panel(props) {
    const key = keyOf(props, props && props.target);
    const s = useStore(key);
    const busy = s.status === "starting" || s.status === "working" || s.status === "stopping";
    const [copied, setCopied] = React.useState(false);
    const state = s.status === "starting" ? ["Starting… (~35 s, first run ~3 min)", "#f59e0b"]
      : s.status === "stopping" ? ["Stopping…", "#f59e0b"]
      : s.status === "working" ? ["Working…", "#f59e0b"]
      : s.status === "error" ? ["Failed", "#ef4444"]
      : s.url ? ["Live", "#22c55e"]
      : s.info && s.info.state === "stopped" ? ["Stopped", "var(--color-text-muted, #a3a3a3)"]
      : ["Not started", "var(--color-text-muted, #a3a3a3)"];
    const small = { fontSize: 12, opacity: 0.6, margin: 0 };
    const pillBtn = { display: "inline-flex", alignItems: "center", font: "inherit", padding: "4px 10px", fontSize: 12, lineHeight: "16px", color: "inherit", background: "transparent", borderRadius: 999, border: "1px solid var(--color-border, rgba(0,0,0,0.1))", cursor: "pointer", minHeight: 0, height: "auto" };
    const btn = (label, cmd, primary) => h("button", { type: "button", disabled: busy, onClick: () => run(key, cmd),
      style: { ...pillBtn, ...(primary ? { fontWeight: 600 } : null), ...(busy ? { opacity: 0.5, cursor: "default" } : null) } }, label);
    const copy = () => { navigator.clipboard && navigator.clipboard.writeText(s.url); setCopied(true); setTimeout(() => setCopied(false), 1200); };

    return h("div", { style: { display: "flex", flexDirection: "column", gap: 14, padding: "var(--space-panel-inset)", width: "100%", fontSize: 13 } },
      // status
      h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
        h("span", { style: { width: 8, height: 8, borderRadius: 9, background: state[1], flex: "none" } }),
        h("span", { style: { fontWeight: 600 } }, state[0]),
        s.info && s.info.region ? h("span", { style: { ...small, marginLeft: "auto" } }, s.info.region) : null),
      // live link
      s.url ? h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
        h("a", { href: s.url, target: "_blank", rel: "noreferrer", style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          s.url.replace(/^https?:\/\//, "") + " ↗"),
        h("button", { type: "button", onClick: copy, style: pillBtn }, copied ? "Copied" : "Copy")) : null,
      // project folder (per channel)
      h("label", { style: { display: "flex", flexDirection: "column", gap: 4 } },
        h("span", { style: small }, "Project folder"),
        h("input", { value: s.folder, disabled: busy, placeholder: lastFolder || "~/code/my-project",
          onChange: (e) => { const v = e.target.value; set(key, { folder: v }); lsSet("folder:" + key, v.trim()); if (v.trim()) { lastFolder = v.trim(); lsSet("folder", lastFolder); } },
          style: { width: "100%" } })),
      // branch
      h("label", { style: { display: "flex", flexDirection: "column", gap: 4 } },
        h("span", { style: small }, "Branch"),
        h("input", { value: s.branch, disabled: busy, placeholder: (s.info && s.info.branch) || "current branch of that folder",
          onChange: (e) => { set(key, { branch: e.target.value }); lsSet("branch:" + key, e.target.value.trim()); }, style: { width: "100%" } })),
      // actions
      h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
        s.url ? h(React.Fragment, null, btn("Pull latest", "sync", true), btn("Stop", "stop")) : btn(busy ? "Starting…" : "Start", "up", true)),
      s.url ? h("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12 } },
        h("span", { style: { opacity: 0.6 } }, s.watching ? "Mirroring saves: refresh to see changes" : "Not mirroring local saves"),
        h("button", { type: "button", style: pillBtn, onClick: () => (s.watching ? stopWatch(key) : startWatch(key)) }, s.watching ? "Pause" : "Mirror saves")) : null,
      s.error ? h("p", { style: { margin: 0, fontSize: 12, color: "var(--color-danger, #ef4444)" } }, s.error) : null,
      // log, collapsed
      s.log.length ? h("details", null,
        h("summary", { style: { ...small, cursor: "pointer" } }, "Log"),
        h("pre", { style: { maxHeight: 200, overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap", margin: "6px 0 0" } }, s.log.slice(-40).join("\n"))) : null);
  }

  // Always-visible strip above the composer in a channel whose sandbox is live: the one
  // consistent place to click through to the link.
  function LiveStrip(props) {
    const key = (props && typeof props.channelId === "string" && props.channelId) || keyOf(props);
    const s = useStore(key);
    React.useEffect(() => { if (!get(key).info && !get(key).proc) run(key, "status", { quiet: true }); }, [key]);
    const pill = { display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", font: "inherit", padding: "4px 10px", fontSize: 12, lineHeight: "16px", textDecoration: "none", color: "inherit", background: "transparent", borderRadius: 999, border: "1px solid var(--color-border, rgba(0,0,0,0.1))", cursor: "pointer" };
    const dot = (c) => h("span", { style: { width: 6, height: 6, borderRadius: 9, background: c, flex: "none" } });
    // Line the pill's right edge up with the composer box. The accessory row spans the full
    // pane while the composer has a max width, so measure the composer and pad to match.
    const wrapRef = React.useRef(null);
    const [padR, setPadR] = React.useState(16);
    React.useLayoutEffect(() => {
      const el = wrapRef.current; if (!el) return;
      const findComposer = () => {
        let scope = el.parentElement;
        for (let i = 0; i < 8 && scope; i++, scope = scope.parentElement) {
          const ed = scope.querySelector('[contenteditable="true"], textarea');
          if (!ed || el.contains(ed)) continue;
          for (let n = ed; n && n !== scope; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderTopLeftRadius) > 0) return n;
          }
          return ed;
        }
        return null;
      };
      const measure = () => {
        const c = findComposer(); if (!c) return;
        const r = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
        if (cr.width > 0) setPadR(Math.max(0, Math.round(r.right - cr.right)));
      };
      measure();
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
      if (ro) { ro.observe(el); const c = findComposer(); if (c) ro.observe(c); }
      window.addEventListener("resize", measure);
      return () => { ro && ro.disconnect(); window.removeEventListener("resize", measure); };
    }, [s.url, s.status]);
    const wrap = (child) => h("div", { ref: wrapRef, style: { display: "flex", justifyContent: "flex-end", marginBottom: 8, paddingRight: padR } }, child);
    if (s.url) {
      return wrap(h("a", { href: s.url, target: "_blank", rel: "noreferrer", title: s.url, style: pill },
        dot("#22c55e"), "Live link", h("span", { "aria-hidden": "true", style: { opacity: 0.6 } }, "↗")));
    }
    if (s.status === "starting") {
      return wrap(h("span", { style: { ...pill, cursor: "default", opacity: 0.8 } }, dot("#f59e0b"), "Starting live link…"));
    }
    const failed = s.status === "error";
    return wrap(h("button", { type: "button", title: failed ? (s.error || "") : "Start this channel's sandbox", style: pill, onClick: () => run(key, "up") },
      dot(failed ? "#ef4444" : "var(--color-text-muted, #a3a3a3)"), failed ? "Live link failed. Retry" : "Start live link"));
  }
  ctx.conversation.registerAccessory({ id: "live-link", title: "Sandbox live link", component: LiveStrip, placement: "composer" });

  // ---- agent tools: the agent doing the work decides which live link a channel shows -----
  const chanOf = (context, args) => {
    const c = context || {};
    const k = (args && args.channel) || c.channelId || c.channel_id || (c.channel && (c.channel.id || c.channel)) || (c.conversation && (c.conversation.channelId || c.conversation.id)) || c.h;
    return typeof k === "string" && k ? k : null;
  };
  const summary = (key, r) => JSON.stringify({ channel: key, ...(r.info || {}), watching: watchers.has(key), error: r.error || undefined });
  ctx.agents.addTool({
    name: "sandbox_link_start",
    description: "Point a channel's live link at a project folder + branch and start (or resume) its Vercel Sandbox dev server. Every file saved in that folder is then mirrored into the sandbox, so a browser refresh shows the change without a commit or push. The folder's checkout should be on the same branch, pushed at least once. Returns the URL. First start ~35 s (up to ~3 min for a new branch). Defaults to the current channel.",
    inputSchema: { type: "object", properties: {
      folder: { type: "string", description: "Absolute path of the local checkout/worktree (must contain scripts/sandbox/link.mjs)." },
      branch: { type: "string", description: "Branch the sandbox runs; normally the folder's current branch." },
      channel: { type: "string", description: "Channel id; defaults to the conversation's channel." } }, required: ["folder", "branch"] },
    call: async (_client, context, args) => {
      const key = chanOf(context, args); if (!key) throw new Error("No channel: pass `channel`. Context keys: " + Object.keys(context || {}).join(","));
      const folder = String(args.folder).trim(), branch = String(args.branch).trim();
      if (get(key).branch.trim() !== branch || (get(key).folder || "").trim() !== folder) stopWatch(key);
      set(key, { folder, branch }); lsSet("folder:" + key, folder); lsSet("branch:" + key, branch); lastFolder = folder; lsSet("folder", folder);
      const r = await run(key, "up");
      if (r.error) throw new Error(r.error);
      return summary(key, r);
    },
  });
  ctx.agents.addTool({
    name: "sandbox_link_status",
    description: "Read-only: the current channel's live link (folder, branch, URL, state, whether saves are being mirrored). Never wakes a stopped sandbox.",
    inputSchema: { type: "object", properties: { channel: { type: "string", description: "Channel id; defaults to the conversation's channel." } } },
    call: async (_client, context, args) => {
      const key = chanOf(context, args); if (!key) throw new Error("No channel: pass `channel`. Context keys: " + Object.keys(context || {}).join(","));
      const s = get(key);
      const r = (s.folder || lastFolder).trim() ? await run(key, "status", { quiet: true }) : { error: "no project folder set for this channel" };
      return JSON.stringify({ channel: key, folder: s.folder || lastFolder || null, branch: s.branch || null, ...(r.info || {}), watching: watchers.has(key), error: r.error || undefined });
    },
  });
  ctx.agents.addTool({
    name: "sandbox_link_stop",
    description: "Stop the current channel's live link sandbox and its save mirroring. The URL comes back on the next start.",
    inputSchema: { type: "object", properties: { channel: { type: "string", description: "Channel id; defaults to the conversation's channel." } } },
    call: async (_client, context, args) => {
      const key = chanOf(context, args); if (!key) throw new Error("No channel: pass `channel`.");
      const r = await run(key, "stop");
      if (r.error) throw new Error(r.error);
      return summary(key, r);
    },
  });

  ctx.panels.register({
    id: "sandbox",
    title: "Sandbox link",
    matches: (target) => typeof target === "string" && target.startsWith("sandbox-link:"),
    component: Panel,
    // The host opens the panel from the channel-header icon using this launcher's target;
    // without it the header icon is inert (v3/v4 finding).
    launcher: { icon: ICON, target: "sandbox-link:" },
    channelLauncher: Launcher,
    channelPlacement: "side",
  });
}
