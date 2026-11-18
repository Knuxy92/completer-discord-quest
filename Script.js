(() => {
  "use strict";

  globalThis.questManager?.stop?.();
  delete window.$;

  const wp = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
  webpackChunkdiscord_app.pop();

  const isProxy = v =>
    String(v?.dispatch).includes("e.get") ||
    String(v?.subscribe).includes("e.get") ||
    Boolean(v?.$$loader) ||
    v?.[Symbol.toStringTag] === "IntlMessagesProxy";

  const findExport = pred => {
    for (const m of Object.values(wp?.c ?? {})) {
      const exp = m?.exports;
      if (!exp || exp === window || (typeof exp !== "object" && typeof exp !== "function")) continue;
      for (const k of Reflect.ownKeys(exp)) {
        try {
          const v = exp[k];
          if (pred(v, k, m)) return v;
        } catch {}
      }
    }
    return null;
  };

  const RunningGameStore = findExport((v, k) => k === "Ay" && v?.getRunningGames && v?.getGameForPID);
  const StreamingStore = findExport(v => v?.getStreamerActiveStreamMetadata);
  const ChannelStore = findExport(v => v?.getAllThreadsForParent && v?.getSortedPrivateChannels);
  const GuildChannelStore = findExport((v, k) => k === "Ay" && v?.getSFWDefaultChannel && v?.getAllGuilds);
  const Flux = findExport(v => !isProxy(v) && v?.dispatch && v?.subscribe && v?.flushWaitQueue);
  const rapi =
    findExport((v, k) => k === "Bo" && !isProxy(v) && ["get", "post", "put", "patch", "del"].every(m => typeof v?.[m] === "function")) ??
    findExport(v => !isProxy(v) && v?.getAPIBaseURL && ["get", "post", "put", "patch", "del"].every(m => typeof v?.[m] === "function"));

  const PRIORITY = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"];
  const T = { ENROLL_GAP: 2500, SETTLE: 1500, VIDEO_STEP: 7, VIDEO_MS: 7000, HB_MS: 20000, IDLE_MS: 90000, RETRY_MS: 8000, MAX_RETRIES: 2, MAX_TICKS: 4000 };

  const state = { running: false, abort: false, quests: new Map() };

  const log = (msg, detail) =>
    detail !== undefined ? console.log(`[QuestManager] ${msg}`, detail) : console.log(`[QuestManager] ${msg}`);

  const sleep = ms => new Promise(res => {
    const end = Date.now() + ms;
    const tick = () => state.abort ? res(false) : Date.now() >= end ? res(true) : setTimeout(tick, Math.min(end - Date.now(), 500));
    tick();
  });

  const tryJson = s => { try { return s ? JSON.parse(s) : null; } catch { return { raw: String(s).slice(0, 300) }; } };
  const isFuture = iso => Boolean(iso) && !isNaN(Date.parse(iso)) && Date.parse(iso) > Date.now();

  class ApiError extends Error {
    constructor(status, reason, body) {
      super(`${reason} (${status})`);
      this.status = status;
      this.reason = reason;
      this.body = body;
    }
  }

  const classify = (st, body) =>
    st === 400 && body && typeof body === "object" && "captcha_key" in body ? "captcha" :
    st === 401 || st === 403 ? "forbidden" :
    st === 429 ? "rate_limited" :
    st >= 500 ? "server_error" : "rejected";

  async function req(method, url, body) {
    if (!rapi) throw new ApiError(0, "no_rest_api", null);
    const fn = rapi[{ GET: "get", POST: "post", PUT: "put", PATCH: "patch", DELETE: "del" }[method]];
    try {
      const res = await fn.call(rapi, body === undefined ? { url } : { url, body });
      const data = res?.body ?? tryJson(res?.text) ?? res;
      if (typeof res?.status === "number" && res.status >= 400) throw new ApiError(res.status, classify(res.status, data), data);
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const st = typeof e?.status === "number" ? e.status : 0;
      const data = e?.body ?? tryJson(e?.text);
      throw new ApiError(st, st === 0 ? "transport" : classify(st, data), data);
    }
  }

  async function withRetry(fn, label) {
    for (let i = 0; ; i++) {
      try { return await fn(); }
      catch (e) {
        const transient = e instanceof ApiError && (e.reason === "transport" || e.reason === "server_error");
        if (!transient || i >= T.MAX_RETRIES || state.abort) throw e;
        log(`${label} transient error (${e.reason}) - retrying ${i + 1}/${T.MAX_RETRIES}`);
        if (!(await sleep(T.RETRY_MS))) throw new ApiError(0, "aborted", null);
      }
    }
  }

  function normalize(raw) {
    const cfg = raw?.config ?? {};
    const msg = cfg.messages ?? {};
    const app = cfg.application ?? {};
    const tc = cfg.taskConfigV2 ?? cfg.task_config_v2 ?? cfg.taskConfig ?? cfg.task_config;
    const tasks = Object.entries(tc?.tasks ?? {})
      .map(([type, t]) => ({ type, target: typeof t?.target === "number" ? t.target : null, apps: (t?.applications ?? []).map(a => a?.id).filter(Boolean) }))
      .filter(t => t.target !== null);
    const us = raw?.userStatus ?? raw?.user_status ?? {};
    const spoofTask = PRIORITY.map(p => tasks.find(t => t.type === p)).find(Boolean) ?? null;

    return {
      id: raw?.id,
      name: msg.questName ?? msg.quest_name ?? raw?.id ?? "unknown",
      appId: app.id ?? tasks[0]?.apps?.[0] ?? null,
      appName: app.name ?? msg.gameTitle ?? msg.game_title ?? null,
      startsAt: cfg.startsAt ?? cfg.starts_at ?? null,
      expiresAt: cfg.expiresAt ?? cfg.expires_at ?? null,
      tasks,
      spoofTask,
      enrolled: (us.enrolledAt ?? us.enrolled_at) != null,
      completed: (us.completedAt ?? us.completed_at) != null,
      claimed: (us.claimedAt ?? us.claimed_at) != null,
      progress: us.progress ?? {},
    };
  }

  const prog = (q, type) => Math.max(0, Number(q.progress?.[type]?.value) || 0);
  const expired = (q, now) => q.expiresAt && !isNaN(Date.parse(q.expiresAt)) && Date.parse(q.expiresAt) <= now;
  const started = (q, now) => !q.startsAt || isNaN(Date.parse(q.startsAt)) || Date.parse(q.startsAt) <= now;

  async function spoofVideo({ q, task, rec }, staggerMs) {
    if (staggerMs && !(await sleep(staggerMs))) return (rec.status = "aborted");
    rec.status = "running";
    let ts = prog(q, task.type), ticks = 0;
    log(`[Video] Started "${q.name}" (${Math.floor(ts)}/${task.target}s)`);

    try {
      while (ts < task.target) {
        if (state.abort || !(await sleep(T.VIDEO_MS))) return (rec.status = "aborted");
        if (ticks++ >= T.MAX_TICKS) return (rec.status = "failed", rec.reason = "tick_cap");

        const next = Math.min(task.target, ts + T.VIDEO_STEP);
        const res = await withRetry(() => req("POST", `/quests/${q.id}/video-progress`, { timestamp: next }), q.name);
        const srv = res?.progress?.[task.type]?.value ?? res?.stream_progress_seconds ?? res?.streamProgressSeconds;
        ts = typeof srv === "number" && srv > next ? srv : next;

        log(`[Video] ${q.name}: ${Math.floor(ts)}/${task.target}s`);
        if (res?.completed_at ?? res?.completedAt) break;
      }
      rec.status = "done";
      log(`[Video] "${q.name}" completed`);
    } catch (e) {
      rec.status = state.abort || e?.reason === "aborted" ? "aborted" : "failed";
      rec.reason = e?.reason ?? "spoof_failed";
      if (rec.status === "failed") log(`[Video] "${q.name}" failed (${rec.reason})`, e?.body);
    }
  }

  async function spoofMultiPlay(items) {
    if (!items.length) return;
    if (typeof DiscordNative === "undefined") {
      items.forEach(({ q, rec }) => { rec.status = "failed"; rec.reason = "requires_desktop_app"; log(`[Play] "${q.name}" requires Discord Desktop App`); });
      return;
    }
    if (!RunningGameStore || !Flux) {
      items.forEach(({ rec }) => { rec.status = "failed"; rec.reason = "missing_store"; });
      return log("[Play] RunningGameStore or FluxDispatcher not found");
    }

    const used = new Set(), active = new Map(), games = [];
    await Promise.all(items.map(async ({ q, task, rec }) => {
      const appId = q.appId ?? task.apps[0];
      if (!appId) return (rec.status = "failed", rec.reason = "no_app_id");

      let app = null;
      try {
        const res = await req("GET", `/applications/public?application_ids=${encodeURIComponent(appId)}`);
        app = Array.isArray(res) ? res[0] : res;
      } catch {}

      const name = app?.name ?? q.appName ?? q.name;
      const exe = (app?.executables?.find(x => x.os === "win32") ?? app?.executables?.[0])?.name?.replace(/^>/, "") || `${name.toLowerCase().replace(/[^a-z0-9]/g, "") || "game"}.exe`;
      let pid; do { pid = Math.floor(Math.random() * 30000) + 1000; } while (used.has(pid));
      used.add(pid);

      const game = { cmdLine: `C:\\Program Files\\${name}\\${exe}`, exeName: exe, exePath: `c:/program files/${name.toLowerCase()}/${exe}`, hidden: false, isLauncher: false, id: appId, name, pid, pidPath: [pid], processName: name, start: Date.now() };
      rec.status = "running";
      active.set(q.id, { q, task, rec, game });
      games.push(game);
      log(`[Play] Spoofing "${name}" (${exe}) -> "${q.name}"`);
    }));

    if (!active.size) return;

    const realGames = RunningGameStore.getRunningGames;
    const realPid = RunningGameStore.getGameForPID;
    const prev = realGames.call(RunningGameStore) ?? [];

    try {
      RunningGameStore.getRunningGames = () => [...active.values()].map(e => e.game);
      RunningGameStore.getGameForPID = pid => [...active.values()].find(e => e.game.pid === pid)?.game ?? realPid.call(RunningGameStore, pid);
      Flux.dispatch({ type: "RUNNING_GAMES_CHANGE", added: games, removed: [], games });

      await new Promise(resolve => {
        let lastBeat = Date.now(), done = false;
        const close = () => { if (!done) { done = true; clearInterval(timer); Flux.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onBeat); resolve(); } };

        const onBeat = d => {
          const item = active.get(d?.questId);
          if (!item) return;
          lastBeat = Date.now();
          const p = d?.userStatus?.progress?.[item.task.type]?.value ?? d?.userStatus?.streamProgressSeconds ?? 0;
          log(`[Play] ${item.q.name}: ${Math.floor(p)}/${item.task.target}s`);

          if (p >= item.task.target || d?.userStatus?.completedAt != null) {
            item.rec.status = "done";
            active.delete(item.q.id);
            log(`[Play] "${item.q.name}" completed`);
            Flux.dispatch({ type: "RUNNING_GAMES_CHANGE", added: [], removed: [item.game], games: [...active.values()].map(e => e.game) });
            if (!active.size) close();
          }
        };

        const timer = setInterval(() => {
          if (state.abort || Date.now() - lastBeat > T.IDLE_MS) {
            for (const { q, rec } of active.values()) {
              rec.status = state.abort ? "aborted" : "failed";
              if (!state.abort) { rec.reason = "heartbeat_timeout"; log(`[Play] "${q.name}" heartbeat timeout`); }
            }
            active.clear();
            close();
          }
        }, 500);

        Flux.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onBeat);
      });
    } finally {
      RunningGameStore.getRunningGames = realGames;
      RunningGameStore.getGameForPID = realPid;
      Flux.dispatch({ type: "RUNNING_GAMES_CHANGE", added: [], removed: games, games: prev });
    }
  }

  async function spoofStream({ q, task, rec }) {
    if (typeof DiscordNative === "undefined") return (rec.status = "failed", rec.reason = "requires_desktop_app", log(`[Stream] "${q.name}" requires Discord Desktop App`));
    if (!StreamingStore || !Flux) return (rec.status = "failed", rec.reason = "missing_store");
    const appId = q.appId ?? task.apps[0];
    if (!appId) return (rec.status = "failed", rec.reason = "no_app_id");

    rec.status = "running";
    const pid = Math.floor(Math.random() * 30000) + 1000;
    const realMeta = StreamingStore.getStreamerActiveStreamMetadata;
    log(`[Stream] Spoofing stream for "${q.name}" (must be in voice channel)`);

    try {
      StreamingStore.getStreamerActiveStreamMetadata = () => ({ id: appId, pid, sourceName: null });
      await new Promise(resolve => {
        let lastBeat = Date.now(), done = false;
        const close = () => { if (!done) { done = true; clearInterval(timer); Flux.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onBeat); resolve(); } };

        const onBeat = d => {
          if (d?.questId !== q.id) return;
          lastBeat = Date.now();
          const p = d?.userStatus?.progress?.[task.type]?.value ?? d?.userStatus?.streamProgressSeconds ?? 0;
          log(`[Stream] ${q.name}: ${Math.floor(p)}/${task.target}s`);
          if (p >= task.target || d?.userStatus?.completedAt != null) {
            rec.status = "done";
            log(`[Stream] "${q.name}" completed`);
            close();
          }
        };

        const timer = setInterval(() => {
          if (state.abort || Date.now() - lastBeat > T.IDLE_MS) {
            rec.status = state.abort ? "aborted" : "failed";
            if (!state.abort) { rec.reason = "heartbeat_timeout"; log(`[Stream] "${q.name}" heartbeat timeout`); }
            close();
          }
        }, 500);

        Flux.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onBeat);
      });
    } finally {
      StreamingStore.getStreamerActiveStreamMetadata = realMeta;
    }
  }

  async function spoofActivity({ q, task, rec }) {
    const chId =
      ChannelStore?.getSortedPrivateChannels?.()?.[0]?.id ??
      Object.values(GuildChannelStore?.getAllGuilds?.() ?? {}).find(g => g?.VOCAL?.length)?.VOCAL?.[0]?.channel?.id;

    if (!chId) return (rec.status = "failed", rec.reason = "no_voice_channel", log(`[Activity] No voice/DM channel found for "${q.name}"`));

    rec.status = "running";
    const streamKey = `call:${chId}:1`;
    let ts = prog(q, task.type);

    try {
      while (ts < task.target) {
        if (state.abort || !(await sleep(T.HB_MS))) return (rec.status = "aborted");
        const res = await withRetry(() => req("POST", `/quests/${q.id}/heartbeat`, { stream_key: streamKey, terminal: false }), q.name);
        const srv = res?.progress?.[task.type]?.value ?? res?.stream_progress_seconds ?? res?.streamProgressSeconds;
        ts = typeof srv === "number" ? srv : ts + T.HB_MS / 1000;
        log(`[Activity] ${q.name}: ${Math.floor(ts)}/${task.target}s`);
        if (res?.completed_at ?? res?.completedAt) break;
      }
      await req("POST", `/quests/${q.id}/heartbeat`, { stream_key: streamKey, terminal: true }).catch(() => {});
      rec.status = "done";
      log(`[Activity] "${q.name}" completed`);
    } catch (e) {
      rec.status = state.abort || e?.reason === "aborted" ? "aborted" : "failed";
      rec.reason = e?.reason ?? "spoof_failed";
      if (rec.status === "failed") log(`[Activity] "${q.name}" failed (${rec.reason})`, e?.body);
    }
  }

  async function run() {
    if (state.running) return log("Already running");
    if (!rapi) return log("Discord internal API module (Bo) not found");

    state.running = true;
    state.abort = false;
    state.quests.clear();
    log("Starting auto-run (Auto-Enroll + Parallel Spoof)...");

    let list, enrollBlocked = false;
    try {
      const body = await req("GET", "/quests/@me");
      if (isFuture(body?.quest_access_suspended_until)) {
        state.running = false;
        return log("Quest access suspended - aborting", body.quest_access_suspended_until);
      }
      enrollBlocked = isFuture(body?.quest_enrollment_blocked_until);
      if (enrollBlocked) {
        log("Enrollment blocked by server - skipping new enrolls, spoofing enrolled quests only until", body.quest_enrollment_blocked_until);
      }
      list = (body?.quests ?? []).map(normalize);
    } catch (e) {
      state.running = false;
      return log("Failed to load quests", e?.body ?? e?.message);
    }

    const now = Date.now(), live = [], playQ = [], streamQ = [];
    let vidIdx = 0, deskEnrolled = false;
    log(`Found ${list.length} quest(s)`);

    for (const q of list) {
      if (state.abort) break;
      const rec = { id: q.id, name: q.name, status: "pending", reason: null };
      state.quests.set(q.id, rec);

      if (q.claimed) { rec.status = "skipped"; rec.reason = "already_claimed"; continue; }
      if (q.completed) { rec.status = "skipped"; rec.reason = "already_completed"; continue; }
      if (expired(q, now)) { rec.status = "skipped"; rec.reason = "expired"; continue; }
      if (!started(q, now)) { rec.status = "skipped"; rec.reason = "not_started"; continue; }

      let enrolledNow = false;
      if (!q.enrolled) {
        if (enrollBlocked) {
          rec.status = "skipped";
          rec.reason = "enrollment_blocked";
          continue;
        }
        if (q.tasks.length) {
          if (!(await sleep(T.ENROLL_GAP))) { rec.status = "aborted"; break; }
          try {
            await withRetry(() => req("POST", `/quests/${q.id}/enroll`, { location: 11, is_targeted: false }), q.name);
            q.enrolled = true;
            enrolledNow = true;
            log(`Accepted "${q.name}"`);
          } catch (e) {
            rec.status = "failed";
            rec.reason = e?.reason ?? "enroll_failed";
            log(`Failed to accept "${q.name}" (${rec.reason})`, e?.body);
            continue;
          }
        }
      }

      const task = q.spoofTask;
      if (!task) {
        rec.status = "manual";
        rec.reason = "unsupported";
        log(`Accepted "${q.name}" (unsupported for spoof: ${q.tasks.map(t => t.type).join(", ") || "none"})`);
        continue;
      }

      rec.taskType = task.type;
      const item = { q, task, rec };
      if (task.type === "WATCH_VIDEO" || task.type === "WATCH_VIDEO_ON_MOBILE") live.push(spoofVideo(item, vidIdx++ * 500));
      else if (task.type === "PLAY_ACTIVITY") live.push(spoofActivity(item));
      else if (task.type === "PLAY_ON_DESKTOP") { if (enrolledNow) deskEnrolled = true; playQ.push(item); }
      else if (task.type === "STREAM_ON_DESKTOP") { if (enrolledNow) deskEnrolled = true; streamQ.push(item); }
    }

    if (!state.abort && (playQ.length || streamQ.length)) {
      if (deskEnrolled) await sleep(T.SETTLE);
      if (!state.abort) {
        live.push(spoofMultiPlay(playQ));
        live.push((async () => { for (const item of streamQ) state.abort ? (item.rec.status = "aborted") : await spoofStream(item); })());
      }
    }

    await Promise.all(live);

    const summary = { done: [], manual: [], failed: [], skipped: [], aborted: [] };
    for (const r of state.quests.values()) {
      if (r.status === "done") summary.done.push(`${r.name} (${r.taskType})`);
      else if (r.status === "manual") summary.manual.push(r.name);
      else if (r.status === "failed") summary.failed.push(`${r.name}: ${r.reason}`);
      else if (r.status === "aborted") summary.aborted.push(r.name);
      else summary.skipped.push(`${r.name}: ${r.reason}`);
    }

    state.running = false;
    log("Finished", summary);
  }

  const stop = () => { state.abort = true; log("Stopping and restoring stores..."); };

  globalThis.questManager = globalThis.questAuto = { run, stop, state };
  void run();
})();
