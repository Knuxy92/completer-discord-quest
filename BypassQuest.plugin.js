/**
 * @name BypassQuest
 * @description Auto Bypass All Quest Discord
 * @version 1.0.0
 * @author Xmyers
 */

module.exports = class QuestButton {
    start() {
        this.observer = null;
        this.init();
    }

    stop() {
        if (this.observer) this.observer.disconnect();
        this.removeButton();
    }

    init() {
        this.observer = new MutationObserver(() => this.checkPage());
        this.observer.observe(document.body, { childList: true, subtree: true });
        this.checkPage();
    }

    checkPage() {
        if (window.location.href.includes("/quest-home")) {
            if (!document.getElementById("my-quest-button")) this.addButton();
        } else {
            this.removeButton();
        }
    }

    addButton() {
        const button = document.createElement("button");
        button.id = "my-quest-button";
        button.textContent = "Bypass Quest";

        Object.assign(button.style, {
            position: "fixed",
            bottom: "20px",
            right: "20px",
            zIndex: "9999",
            background: "#FFFFFF",
            color: "#000000",
            border: "2px solid #000000",
            borderRadius: "8px",
            padding: "10px 16px",
            cursor: "pointer",
            fontSize: "14px",
            fontFamily: "'IBM Plex Sans', sans-serif",
            fontWeight: "600",
        });

        if (!document.getElementById("ibm-plex-font")) {
            const link = document.createElement("link");
            link.id = "ibm-plex-font";
            link.rel = "stylesheet";
            link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@600&display=swap";
            document.head.appendChild(link);
        }
        button.addEventListener("click", () => this.runBypass());
        button.addEventListener("mouseenter", () => {
            button.style.background = "#000000";
            button.style.color = "#FFFFFF";
        });
        button.addEventListener("mouseleave", () => {
            button.style.background = "#FFFFFF";
            button.style.color = "#000000";
        });
        document.body.appendChild(button);
    }

    removeButton() {
        document.getElementById("my-quest-button")?.remove();
    }

    async runBypass() {
        const SUPPORTED_TASKS = [
            "WATCH_VIDEO",
            "PLAY_ON_DESKTOP",
            "STREAM_ON_DESKTOP",
            "WATCH_VIDEO_ON_MOBILE",
        ];

        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const toast = (msg, type = "info", timeout = 1500) =>
            BdApi.UI.showToast(msg, { type, timeout });

        BdApi.UI.showToast("Starting Bypass", { type: "info", timeout: 1500 });

        delete window.$;
        const wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
        webpackChunkdiscord_app.pop();

        const findModule = predicate => Object.values(wpRequire.c).find(predicate);
        const streamStore = findModule(x => x?.exports?.Z?.__proto__?.getStreamerActiveStreamMetadata)?.exports?.Z;
        const alt = !streamStore;
        const getExport = (finder, primary, altKey) =>
            findModule(finder)?.exports?.[alt ? altKey : primary];

        const ApplicationStreamingStore = streamStore
            || findModule(x => x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata).exports.A;
        const RunningGameStore = getExport(x => x?.exports?.[alt ? "Ay" : "ZP"]?.getRunningGames, "ZP", "Ay");
        const QuestsStore = getExport(x => x?.exports?.[alt ? "A" : "Z"]?.__proto__?.getQuest, "Z", "A");
        const FluxDispatcher = getExport(x => x?.exports?.[alt ? "h" : "Z"]?.__proto__?.flushWaitQueue, "Z", "h");
        const api = getExport(x => x?.exports?.[alt ? "Bo" : "tn"]?.get, "tn", "Bo");

        const fakeGamesMap = new Map();
        RunningGameStore.getRunningGames = () => [...fakeGamesMap.values()];
        RunningGameStore.getGameForPID = pid => fakeGamesMap.get(pid);

        const enrollQuest = async (questId, questName) => {
            toast(`[System] Enrolling: ${questName}`);
            try { await api.post({ url: `/quests/${questId}/enroll` }); } catch {}
            await sleep(2000);
        };

        const processVideoQuest = async (quest, taskName, secondsNeeded) => {
            const questName = quest.config.messages.questName;
            let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

            while (secondsDone < secondsNeeded) {
                const timestamp = Math.min(secondsNeeded, secondsDone + 7 + Math.random());
                try {
                    const res = await api.post({
                        url: `/quests/${quest.id}/video-progress`,
                        body: { timestamp },
                    });
                    secondsDone = timestamp;
                    toast(`[Video] ${questName}: ${Math.floor(secondsDone)}/${secondsNeeded}s`, "success");
                    if (res.body.completed_at) break;
                } catch {}
                await sleep(3000);
            }
            toast(`[Video] Completed ${questName}`, "success", 2000);
        };

        const createFakeGame = (appData, questId) => {
            const pid = Math.floor(Math.random() * 30000) + 1000;
            const safeName = (appData.name || "UnknownGame").replace(/\s/g, "");
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
                isLauncher: false,
            };
        };

        const processGameQuest = async (quest, taskName, secondsNeeded) => {
            const questName = quest.config.messages.questName;
            let appData;
            try {
                const res = await api.get({ url: `/applications/public?application_ids=${quest.config.application.id}` });
                appData = res.body[0];
            } catch { return; }

            const fakeGame = createFakeGame(appData, quest.config.application.id);
            fakeGamesMap.set(fakeGame.pid, fakeGame);

            FluxDispatcher.dispatch({
                type: "RUNNING_GAMES_CHANGE",
                removed: [],
                added: [fakeGame],
                games: [...fakeGamesMap.values()],
            });

            await new Promise(resolve => {
                const handleHeartbeat = data => {
                    if (data.userStatus.questId !== quest.id) return;
                    const progress = Math.floor(data.userStatus.progress?.[taskName]?.value ?? 0);
                    toast(`[Game] ${questName}: ${progress}/${secondsNeeded}s`, "success");
                    if (progress >= secondsNeeded) {
                        fakeGamesMap.delete(fakeGame.pid);
                        FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", handleHeartbeat);
                        toast(`[Game] Completed: ${questName}`, "success", 2000);
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

            if (!quest.userStatus?.enrolledAt) await enrollQuest(quest.id, questName);

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
            toast(`[QuestManager] Found ${allQuests.length} active quests`, "info", 2500);
            allQuests.forEach((q, i) => processQuest(q, i));
        } else {
            toast("[QuestManager] No pending quests found.", "error", 2500);
        }
    }
};