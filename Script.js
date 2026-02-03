(async () => {
    delete window.$;
    const wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
    webpackChunkdiscord_app.pop();

    const findModule = (predicate) => Object.values(wpRequire.c).find(predicate);
    
    const streamStore = findModule(x => x?.exports?.Z?.__proto__?.getStreamerActiveStreamMetadata)?.exports?.Z;
    const useAltExports = !streamStore;
    
    const getExport = (finder, primary, alt) => 
        findModule(finder)?.exports?.[useAltExports ? alt : primary];

    const ApplicationStreamingStore = streamStore || findModule(x => x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata).exports.A;
    const RunningGameStore = getExport(x => x?.exports?.[useAltExports ? 'Ay' : 'ZP']?.getRunningGames, 'ZP', 'Ay');
    const QuestsStore = getExport(x => x?.exports?.[useAltExports ? 'A' : 'Z']?.__proto__?.getQuest, 'Z', 'A');
    const FluxDispatcher = getExport(x => x?.exports?.[useAltExports ? 'h' : 'Z']?.__proto__?.flushWaitQueue, 'Z', 'h');
    const api = getExport(x => x?.exports?.[useAltExports ? 'Bo' : 'tn']?.get, 'tn', 'Bo');

    const SUPPORTED_TASKS = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "WATCH_VIDEO_ON_MOBILE"];
    const fakeGamesMap = new Map();
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    RunningGameStore.getRunningGames = () => Array.from(fakeGamesMap.values());
    RunningGameStore.getGameForPID = pid => fakeGamesMap.get(pid);

    const enrollQuest = async (questId, questName) => {
        console.log(`[System] Enrolling: ${questName}`);
        try {
            await api.post({ url: `/quests/${questId}/enroll` });
            await sleep(2000);
        } catch {}
    };

    const processVideoQuest = async (quest, taskName, secondsNeeded) => {
        const questName = quest.config.messages.questName;
        let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;
        
        console.log(`[Video] Started: ${questName}`);
        while (secondsDone < secondsNeeded) {
            const timestamp = Math.min(secondsNeeded, secondsDone + 7 + Math.random());
            try {
                const res = await api.post({ 
                    url: `/quests/${quest.id}/video-progress`, 
                    body: { timestamp } 
                });
                secondsDone = timestamp;
                console.log(`[Video] ${questName}: ${Math.floor(secondsDone)}/${secondsNeeded}s`);
                if (res.body.completed_at) break;
            } catch {}
            await sleep(3000);
        }
        console.log(`[Video] Completed: ${questName}`);
    };

    const createFakeGame = (appData, questId) => {
        const pid = Math.floor(Math.random() * 30000) + 1000;
        const safeName = (appData.name || "UnknownGame").replace(/\s/g, '');
        const lowerName = safeName.toLowerCase();
        
        return {
            id: questId,
            name: appData.name,
            pid,
            pidPath: [pid],
            start: Date.now(),
            exeName: `${safeName}.exe`,
            exePath: `c:/program files/${lowerName}/${lowerName}.exe`,
            processName: safeName,
            cmdLine: `C:\\Program Files\\${safeName}\\${safeName}.exe`,
            hidden: false,
            isLauncher: false
        };
    };

    const processGameQuest = async (quest, taskName, secondsNeeded) => {
        const questName = quest.config.messages.questName;
        let appData;
        
        try {
            const res = await api.get({ 
                url: `/applications/public?application_ids=${quest.config.application.id}` 
            });
            appData = res.body[0];
        } catch { return; }

        const fakeGame = createFakeGame(appData, quest.config.application.id);
        fakeGamesMap.set(fakeGame.pid, fakeGame);
        
        FluxDispatcher.dispatch({ 
            type: "RUNNING_GAMES_CHANGE", 
            removed: [], 
            added: [fakeGame], 
            games: Array.from(fakeGamesMap.values()) 
        });

        return new Promise(resolve => {
            const handleHeartbeat = data => {
                if (data.userStatus.questId !== quest.id) return;
                
                const progress = Math.floor(data.userStatus.progress?.[taskName]?.value ?? 0);
                console.log(`[Game] ${questName}: ${progress}/${secondsNeeded}s`);
                
                if (progress >= secondsNeeded) {
                    fakeGamesMap.delete(fakeGame.pid);
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", handleHeartbeat);
                    console.log(`[Game] Completed: ${questName}`);
                    resolve();
                }
            };
            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", handleHeartbeat);
        });
    };

    const processQuest = async (quest, index) => {
        await sleep(index * 5000);

        const questName = quest.config.messages.questName;
        const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
        const taskName = SUPPORTED_TASKS.find(x => taskConfig.tasks[x]);
        const secondsNeeded = taskConfig.tasks[taskName].target;

        if (!quest.userStatus?.enrolledAt) {
            await enrollQuest(quest.id, questName);
        }

        if (taskName.includes("WATCH_VIDEO")) {
            await processVideoQuest(quest, taskName, secondsNeeded);
        } else if (taskName === "PLAY_ON_DESKTOP") {
            await processGameQuest(quest, taskName, secondsNeeded);
        }
    };

    const allQuests = [...QuestsStore.quests.values()].filter(x => 
        !x.userStatus?.completedAt && 
        new Date(x.config.expiresAt).getTime() > Date.now() && 
        SUPPORTED_TASKS.some(y => Object.keys((x.config.taskConfig ?? x.config.taskConfigV2).tasks).includes(y))
    );

    if (allQuests.length > 0) {
        console.clear();
        console.log(`[QuestManager] Found ${allQuests.length} active quests. Starting staggered processing...`);
        allQuests.forEach((q, i) => processQuest(q, i));
    } else {
        console.log("[QuestManager] No pending quests found.");
    }
})();
