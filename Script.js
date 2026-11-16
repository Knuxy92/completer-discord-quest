(() => {
  "use strict";
  delete window.$;

  const wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
  webpackChunkdiscord_app.pop();

  const methods = ["get", "post", "put", "patch", "del"];
  const isLocaleProxy = v =>
    String(v?.dispatch).includes("e.get") ||
    String(v?.subscribe).includes("e.get") ||
    Boolean(v?.$$loader) ||
    v?.[Symbol.toStringTag] === "IntlMessagesProxy";

  const findExport = predicate => {
    for (const [id, mod] of Object.entries(wpRequire?.c ?? {})) {
      const exp = mod?.exports;
      if (!exp || exp === window || !["object", "function"].includes(typeof exp)) continue;
      for (const key of Reflect.ownKeys(exp)) {
        try {
          const value = exp[key];
          if (predicate(value, key, mod)) return value;
        } catch {}
      }
    }
    return null;
  };

  const rapi =
    findExport((v, key) => key === "Bo" && !isLocaleProxy(v) && methods.every(m => typeof v?.[m] === "function")) ??
    findExport(v => !isLocaleProxy(v) && typeof v?.getAPIBaseURL === "function" && methods.every(m => typeof v?.[m] === "function"));

  const GLOBAL_KEY = "__discordQuestAuto";
  const ENROLL_DELAY_MS = 1500;
  const RETRY_DELAY_MS = 8000;
  const MAX_RETRIES = 2;
  const state = { running: false, abort: false, quests: new Map(), log: [] };

  function log(level, message, detail) {
    const entry = { at: new Date().toISOString(), level, message };
    if (detail !== undefined) entry.detail = detail;
    state.log.push(entry);
    const prefix = level === "error" ? "✖" : level === "warn" ? "!" : "›";
    console.log(`${prefix} [QuestManager] ${message}`, detail ?? "");
  }

  const sleep = ms => new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      if (state.abort) return resolve(false);
      const remaining = ms - (Date.now() - start);
      if (remaining <= 0) return resolve(true);
      setTimeout(tick, Math.min(remaining, 500));
    };
    tick();
  });

  const parseResponse = value => {
    if (!value) return null;
    try { return JSON.parse(value); } catch { return value; }
  };

  async function apiRequest(method, path, body) {
    if (!rapi) throw new Error("Discord internal REST API module not found");
    const fn = rapi[method];
    const response = await fn.call(rapi, { url: path, ...(body !== undefined ? { body } : {}) });
    const data = response?.body ?? parseResponse(response?.text) ?? response;
    if (typeof response?.status === "number" && response.status >= 400) {
      const error = new Error(`Request rejected (HTTP ${response.status})`);
      error.status = response.status;
      error.body = data;
      throw error;
    }
    return data;
  }

  function normalizeQuest(raw) {
    const config = raw?.config ?? {};
    const status = raw?.userStatus ?? raw?.user_status ?? {};
    const messages = config.messages ?? {};
    const taskConfig = config.taskConfigV2 ?? config.task_config_v2 ?? config.taskConfig ?? config.task_config;
    const tasks = taskConfig?.tasks ?? {};

    return {
      id: raw?.id,
      name: messages.questName ?? messages.quest_name ?? raw?.id ?? "Unknown quest",
      startsAt: config.startsAt ?? config.starts_at ?? null,
      expiresAt: config.expiresAt ?? config.expires_at ?? null,
      hasTasks: Object.keys(tasks).length > 0,
      enrolled: Boolean(status.enrolledAt ?? status.enrolled_at),
      completed: Boolean(status.completedAt ?? status.completed_at),
      claimed: Boolean(status.claimedAt ?? status.claimed_at)
    };
  }

  const isExpired = (quest, now) => {
    if (!quest.expiresAt) return false;
    const time = new Date(quest.expiresAt).getTime();
    return Number.isFinite(time) && time <= now;
  };

  const hasStarted = (quest, now) => {
    if (!quest.startsAt) return true;
    const time = new Date(quest.startsAt).getTime();
    return !Number.isFinite(time) || time <= now;
  };

  function getSkipReason(quest, now) {
    if (quest.claimed) return "already_claimed";
    if (quest.completed) return "already_completed";
    if (quest.enrolled) return "already_enrolled";
    if (isExpired(quest, now)) return "expired";
    if (!hasStarted(quest, now)) return "not_started_yet";
    if (!quest.hasTasks) return "no_tasks";
    return null;
  }

  async function fetchCurrentQuests() {
    const response = await apiRequest("get", "/quests/@me");
    return {
      quests: (Array.isArray(response?.quests) ? response.quests : []).map(normalizeQuest),
      enrollmentBlockedUntil: response?.quest_enrollment_blocked_until ?? null,
      accessSuspendedUntil: response?.quest_access_suspended_until ?? null
    };
  }

  async function enrollQuest(quest) {
    for (let attempt = 0; ; attempt++) {
      try {
        await apiRequest("post", `/quests/${encodeURIComponent(quest.id)}/enroll`, {
          location: 11,
          is_targeted: false
        });
        quest.enrolled = true;
        log("info", `Accepted "${quest.name}"`, { questId: quest.id });
        return;
      } catch (error) {
        const retryable = !error.status || error.status >= 500;
        if (!retryable || attempt >= MAX_RETRIES || state.abort) throw error;
        log("warn", `Temporary enrollment error for "${quest.name}"; retry ${attempt + 1}/${MAX_RETRIES}`);
        if (!await sleep(RETRY_DELAY_MS)) throw new Error("Operation stopped");
      }
    }
  }

  async function run() {
    if (state.running) return log("warn", "Already running");
    if (!rapi) return log("error", "Discord internal REST API module not found");

    state.running = true;
    state.abort = false;
    state.quests.clear();
    state.log.length = 0;

    const summary = { enrolled: [], skipped: [], failed: [], aborted: [] };

    try {
      const listing = await fetchCurrentQuests();

      if (listing.enrollmentBlockedUntil || listing.accessSuspendedUntil) {
        log("warn", "Quest enrollment or access is temporarily restricted", {
          enrollmentBlockedUntil: listing.enrollmentBlockedUntil,
          accessSuspendedUntil: listing.accessSuspendedUntil
        });
        return summary;
      }

      const quests = listing.quests;
      const now = Date.now();
      log("info", `Found ${quests.length} quest(s)`);

      for (const quest of quests) {
        const record = { id: quest.id, name: quest.name, status: "pending", reason: null };
        state.quests.set(quest.id, record);

        const reason = getSkipReason(quest, now);
        if (reason) {
          record.status = "skipped";
          record.reason = reason;
          summary.skipped.push({ name: quest.name, reason });
          continue;
        }

        if (!await sleep(ENROLL_DELAY_MS)) {
          record.status = "aborted";
          summary.aborted.push(quest.name);
          break;
        }

        try {
          await enrollQuest(quest);
          record.status = "enrolled";
          summary.enrolled.push(quest.name);
        } catch (error) {
          if (state.abort) {
            record.status = "aborted";
            summary.aborted.push(quest.name);
            break;
          }
          record.status = "failed";
          record.reason = error.message;
          summary.failed.push({ name: quest.name, reason: error.message, status: error.status ?? 0 });
          log("error", `Failed to accept "${quest.name}"`, error.body ?? error.message);
        }
      }
    } catch (error) {
      log("error", "Quest retrieval failed", error.body ?? error.message);
    } finally {
      state.running = false;
      log("info", "Enrollment run finished", summary);
    }

    return summary;
  }

  function stop() {
    state.abort = true;
    log("warn", "Stop requested");
  }

  const questAuto = { stop, fetchCurrentQuests, state };
  globalThis[GLOBAL_KEY] = questAuto;
  globalThis.questAuto = questAuto;

  console.log(`%c[QuestManager] Starting... (REST API: ${rapi ? "OK" : "NOT FOUND"})`, "font-weight:bold");
  run().catch(error => {
    state.running = false;
    log("error", "Unexpected runtime error", error?.message ?? error);
  });
})();
