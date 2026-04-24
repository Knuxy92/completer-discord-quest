(async () => {
  delete window.$;

  const wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
  webpackChunkdiscord_app.pop();

  const isLocaleProxy = v =>
    String(v?.dispatch).includes("e.get") ||
    String(v?.subscribe).includes("e.get") ||
    v?.$$loader;

  const readExports = exp => {
    if (!exp || (typeof exp !== "object" && typeof exp !== "function")) return [];
    return Reflect.ownKeys(exp).flatMap(k => {
      try { return [{ key: k, value: exp[k] }]; }
      catch { return []; }
    });
  };

  const findExport = predicate => {
    for (const [id, m] of Object.entries(wpRequire.c)) {
      for (const { key, value } of readExports(m.exports)) {
        try {
          if (predicate(value, key, m)) return { id, key, value, module: m };
        } catch {}
      }
    }
    return null;
  };

  const QuestsStore = findExport(v =>
    v?.getQuest && v.quests instanceof Map
  )?.value;

  const ApplicationStreamingStore = findExport(v =>
    v?.getStreamerActiveStreamMetadata
  )?.value;

  const RunningGameStore = findExport((v, k) =>
    k === "Ay" && typeof v?.getRunningGames === "function" && typeof v?.getGameForPID === "function"
  )?.value;

  const FluxDispatcher = findExport(v =>
    !isLocaleProxy(v) &&
    typeof v?.dispatch === "function" &&
    typeof v?.subscribe === "function" &&
    typeof v?.flushWaitQueue === "function"
  )?.value;

  const api = findExport((v, k) =>
    k === "Bo" &&
    ["get", "post", "put", "patch", "del"].every(m => typeof v?.[m] === "function")
  )?.value;

  const SUPPORTED_TASKS = [
    "WATCH_VIDEO",
    "PLAY_ON_DESKTOP",
    "STREAM_ON_DESKTOP",
    "WATCH_VIDEO_ON_MOBILE",
  ];

  const fakeGamesMap = new Map();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  RunningGameStore.getRunningGames = () => [...fakeGamesMap.values()];
  RunningGameStore.getGameForPID   = pid => fakeGamesMap.get(pid);

  const enrollQuest = async (questId, questName) => {
    console.log(`[Enroll] ${questName}`);
    try {
      await api.post({ url: `/quests/${questId}/enroll` });
      await sleep(2000);
    } catch {}
  };

  const processVideoQuest = async (quest, taskName, target) => {
    const name = quest.config.messages.questName;
    let progress = quest.userStatus?.progress?.[taskName]?.value ?? 0;

    console.log(`[Video] Start: ${name}`);

    while (progress < target) {
      const timestamp = Math.min(target, progress + 7 + Math.random());
      try {
        const res = await api.post({
          url: `/quests/${quest.id}/video-progress`,
          body: { timestamp },
        });
        progress = timestamp;
        console.log(`[Video] ${name}: ${Math.floor(progress)}/${target}s`);
        if (res.body.completed_at) break;
      } catch {}
      await sleep(3000);
    }

    console.log(`[Video] Done: ${name}`);
  };

  const createFakeGame = (appData, questId) => {
    const pid      = Math.floor(Math.random() * 30000) + 1000;
    const safe     = (appData.name || "UnknownGame").replace(/\s/g, "");
    const lower    = safe.toLowerCase();

    return {
      id: questId, name: appData.name, pid,
      pidPath: [pid], start: Date.now(),
      exeName: `${safe}.exe`,
      exePath: `c:/program files/${lower}/${lower}.exe`,
      processName: safe,
      cmdLine: `C:\\Program Files\\${safe}\\${safe}.exe`,
      hidden: false, isLauncher: false,
    };
  };

  const processGameQuest = async (quest, taskName, target) => {
    const name = quest.config.messages.questName;

    let appData;
    try {
      const res = await api.get({
        url: `/applications/public?application_ids=${quest.config.application.id}`,
      });
      appData = res.body[0];
    } catch {
      console.log(`[Game] Failed to fetch app data for: ${name}`);
      return;
    }

    const fakeGame = createFakeGame(appData, quest.config.application.id);
    fakeGamesMap.set(fakeGame.pid, fakeGame);

    FluxDispatcher.dispatch({
      type: "RUNNING_GAMES_CHANGE",
      removed: [],
      added: [fakeGame],
      games: [...fakeGamesMap.values()],
    });

    await new Promise(resolve => {
      const onHeartbeat = ({ userStatus }) => {
        if (userStatus.questId !== quest.id) return;

        const progress = Math.floor(userStatus.progress?.[taskName]?.value ?? 0);
        console.log(`[Game] ${name}: ${progress}/${target}s`);

        if (progress >= target) {
          fakeGamesMap.delete(fakeGame.pid);
          FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
          console.log(`[Game] Done: ${name}`);
          resolve();
        }
      };
      FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
    });
  };

  const processQuest = async (quest, index) => {
    await sleep(index * 5000);

    const name       = quest.config.messages.questName;
    const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
    const taskName   = SUPPORTED_TASKS.find(t => taskConfig.tasks[t]);
    const target     = taskConfig.tasks[taskName].target;

    if (!quest.userStatus?.enrolledAt) await enrollQuest(quest.id, name);

    if (taskName.includes("WATCH_VIDEO"))   await processVideoQuest(quest, taskName, target);
    else if (taskName === "PLAY_ON_DESKTOP") await processGameQuest(quest, taskName, target);
  };

  const pending = [...QuestsStore.quests.values()].filter(q =>
    !q.userStatus?.completedAt &&
    Date.now() < new Date(q.config.expiresAt).getTime() &&
    SUPPORTED_TASKS.some(t =>
      Object.keys((q.config.taskConfig ?? q.config.taskConfigV2).tasks).includes(t)
    )
  );

  if (!pending.length) {
    console.log("[QuestManager] No pending quests.");
    return;
  }

  console.clear();
  console.log(`[QuestManager] ${pending.length} quest(s) found — processing...`);
  pending.forEach((q, i) => processQuest(q, i));
})();
