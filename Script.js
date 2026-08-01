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

  const ChannelStore = findExport(v =>
    typeof v?.getAllThreadsForParent === "function" &&
    typeof v?.getSortedPrivateChannels === "function"
  )?.value;

  const GuildChannelStore = findExport((v, k) =>
    k === "Ay" && typeof v?.getSFWDefaultChannel === "function" && typeof v?.getAllGuilds === "function"
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
    "PLAY_ACTIVITY",
    "WATCH_VIDEO_ON_MOBILE",
  ];

  const isApp = typeof DiscordNative !== "undefined";
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const enrollQuest = async (questId, questName) => {
    console.log(`[Enroll] ${questName}`);
    try {
      await api.post({ url: `/quests/${questId}/enroll` });
      await sleep(2000);
    } catch (e) {
      console.log(`[Enroll] Failed for ${questName}:`, e?.message ?? e);
    }
  };

  const processVideoQuest = async (quest, taskName, target) => {
    const name = quest.config.messages.questName;
    let progress = quest.userStatus?.progress?.[taskName]?.value ?? 0;
    const speed = 7;

    console.log(`[Video] Start: ${name}`);

    while (progress < target) {
      const remaining = Math.min(speed, target - progress);
      await sleep(remaining * 1000);

      const timestamp = Math.min(target, progress + speed + Math.random());
      try {
        const res = await api.post({
          url: `/quests/${quest.id}/video-progress`,
          body: { timestamp },
        });
        progress = timestamp;
        console.log(`[Video] ${name}: ${Math.floor(progress)}/${target}s`);
        if (res.body.completed_at) break;
      } catch (e) {
        console.log(`[Video] ${name} heartbeat failed:`, e?.message ?? e);
        await sleep(5000);
      }
    }

    console.log(`[Video] Done: ${name}`);
  };

  const createFakeGame = (appData, applicationId) => {
    const pid   = Math.floor(Math.random() * 30000) + 1000;
    const safe  = (appData.name || "UnknownGame").replace(/\s/g, "");
    const lower = safe.toLowerCase();

    return {
      id: applicationId, name: appData.name, pid,
      pidPath: [pid], start: Date.now(),
      exeName: `${safe}.exe`,
      exePath: `c:/program files/${lower}/${lower}.exe`,
      processName: safe,
      cmdLine: `C:\\Program Files\\${safe}\\${safe}.exe`,
      hidden: false, isLauncher: false,
    };
  };

  const processGameQuest = async (quest, taskName, target, applicationId) => {
    const name = quest.config.messages.questName;

    if (!applicationId) {
      console.log(`[Game] ${name}: no applicationId, skipping.`);
      return;
    }

    if (!isApp) {
      console.log(`[Game] ${name}: requires desktop app, skipping.`);
      return;
    }

    let appData;
    try {
      const res = await api.get({
        url: `/applications/public?application_ids=${applicationId}`,
      });
      appData = res.body[0];
    } catch (e) {
      console.log(`[Game] Failed to fetch app data for ${name}:`, e?.message ?? e);
      return;
    }

    const fakeGame = createFakeGame(appData, applicationId);

    const realGetRunningGames = RunningGameStore.getRunningGames;
    const realGetGameForPID   = RunningGameStore.getGameForPID;
    const realGames = realGetRunningGames();

    RunningGameStore.getRunningGames = () => [fakeGame];
    RunningGameStore.getGameForPID   = pid => (pid === fakeGame.pid ? fakeGame : undefined);

    FluxDispatcher.dispatch({
      type: "RUNNING_GAMES_CHANGE",
      removed: realGames,
      added: [fakeGame],
      games: [fakeGame],
    });

    const secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;
    console.log(`[Game] Spoofed: ${appData.name}. Wait ${Math.ceil((target - secondsDone) / 60)} min.`);

    await new Promise(resolve => {
      const onHeartbeat = data => {
        const progress = Math.floor(data.userStatus?.progress?.[taskName]?.value ?? 0);
        console.log(`[Game] ${name}: ${progress}/${target}s`);

        if (progress >= target) {
          RunningGameStore.getRunningGames = realGetRunningGames;
          RunningGameStore.getGameForPID   = realGetGameForPID;
          FluxDispatcher.dispatch({
            type: "RUNNING_GAMES_CHANGE",
            removed: [fakeGame],
            added: [],
            games: [],
          });
          FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
          console.log(`[Game] Done: ${name}`);
          resolve();
        }
      };
      FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
    });
  };

  const processStreamQuest = async (quest, taskName, target, applicationId) => {
    const name = quest.config.messages.questName;

    if (!applicationId) {
      console.log(`[Stream] ${name}: no applicationId, skipping.`);
      return;
    }

    if (!isApp) {
      console.log(`[Stream] ${name}: requires desktop app, skipping.`);
      return;
    }

    const pid = Math.floor(Math.random() * 30000) + 1000;
    const realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

    ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
      id: applicationId,
      pid,
      sourceName: null,
    });

    const secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;
    console.log(`[Stream] ${name}: spoofed. Stream any window in VC for ${Math.ceil((target - secondsDone) / 60)} min.`);
    console.log(`[Stream] Need at least 1 other person in the VC!`);

    await new Promise(resolve => {
      const onHeartbeat = data => {
        const progress = Math.floor(data.userStatus?.progress?.[taskName]?.value ?? 0);
        console.log(`[Stream] ${name}: ${progress}/${target}s`);

        if (progress >= target) {
          ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
          FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
          console.log(`[Stream] Done: ${name}`);
          resolve();
        }
      };
      FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
    });
  };

  const processActivityQuest = async (quest, taskName, target) => {
    const name = quest.config.messages.questName;

    const channelId =
      ChannelStore.getSortedPrivateChannels()[0]?.id ??
      Object.values(GuildChannelStore.getAllGuilds())
        .find(x => x != null && x.VOCAL.length > 0)?.VOCAL[0]?.channel?.id;

    if (!channelId) {
      console.log(`[Activity] ${name}: no voice channel found, skipping.`);
      return;
    }

    const streamKey = `call:${channelId}:1`;
    console.log(`[Activity] Start: ${name}`);

    while (true) {
      let progress;
      try {
        const res = await api.post({
          url: `/quests/${quest.id}/heartbeat`,
          body: { stream_key: streamKey, terminal: false },
        });
        progress = res.body.progress.PLAY_ACTIVITY.value;
        console.log(`[Activity] ${name}: ${progress}/${target}s`);
      } catch (e) {
        console.log(`[Activity] ${name} heartbeat failed:`, e?.message ?? e);
        await sleep(20000);
        continue;
      }

      if (progress >= target) {
        try {
          await api.post({
            url: `/quests/${quest.id}/heartbeat`,
            body: { stream_key: streamKey, terminal: true },
          });
        } catch (e) {
          console.log(`[Activity] ${name} terminal heartbeat failed:`, e?.message ?? e);
        }
        break;
      }

      await sleep(20000);
    }

    console.log(`[Activity] Done: ${name}`);
  };

  const processQuest = async quest => {
    const name       = quest.config.messages.questName;
    const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
    const taskName   = SUPPORTED_TASKS.find(t => taskConfig.tasks[t]);
    const taskData   = taskConfig.tasks[taskName];
    const target     = taskData.target;
    const applicationId = quest.config.application?.id ?? taskData.applications?.[0]?.id;

    if (!quest.userStatus?.enrolledAt) await enrollQuest(quest.id, name);

    if (taskName.includes("WATCH_VIDEO"))      await processVideoQuest(quest, taskName, target);
    else if (taskName === "PLAY_ON_DESKTOP")   await processGameQuest(quest, taskName, target, applicationId);
    else if (taskName === "STREAM_ON_DESKTOP") await processStreamQuest(quest, taskName, target, applicationId);
    else if (taskName === "PLAY_ACTIVITY")     await processActivityQuest(quest, taskName, target);
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

  for (const quest of pending) {
    await processQuest(quest);
  }

  console.log("[QuestManager] All quests done.");
})();
