/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findLazy } from "@webpack";
import { createRoot, FluxDispatcher, React, RestAPI } from "@webpack/common";
import type { Root } from "react-dom/client";

const logger = new Logger("QuestCompleter");

const QuestsStore = findLazy(m =>
    typeof m === "object" && m !== null &&
    typeof (m as any).getQuest === "function" &&
    (m as any).quests instanceof Map
);
const ApplicationStreamingStore = findByPropsLazy("getStreamerActiveStreamMetadata");
const RunningGameStore = findByPropsLazy("getRunningGames", "getGameForPID");
const ChannelStore = findByPropsLazy("getAllThreadsForParent", "getSortedPrivateChannels");
const GuildChannelStore = findByPropsLazy("getSFWDefaultChannel", "getAllGuilds");

const SUPPORTED_TASKS = [
    "WATCH_VIDEO",
    "PLAY_ON_DESKTOP",
    "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY",
    "WATCH_VIDEO_ON_MOBILE",
] as const;

const QUEST_HOME_PATH = "/quest-home";

const CAPTCHA_MODAL_SELECTORS = [
    '[data-testid="captcha-modal"]',
    '[class*="captcha"]',
    'iframe[src*="captcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="recaptcha"]',
];

const settings = definePluginSettings({
    showOnQuestHomeOnly: {
        description: "Show the button only on the Quest Home page",
        type: OptionType.BOOLEAN,
        default: true,
    },
    autoEnroll: {
        description: "Auto-accept all available quests before completing",
        type: OptionType.BOOLEAN,
        default: true,
    },
    autoClaim: {
        description: "Auto-claim rewards for completed quests",
        type: OptionType.BOOLEAN,
        default: true,
    },
    autoClickCaptcha: {
        description: "Try to click captcha checkboxes/verify buttons automatically (falls back to manual if it fails)",
        type: OptionType.BOOLEAN,
        default: true,
    },
});

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const isApp = () => typeof DiscordNative !== "undefined";

const fakeGamesMap = new Map<number, any>();

let realGetRunningGames: (() => any[]) | null = null;
let realGetGameForPID: ((pid: number) => any) | null = null;
let realStreamMetadata: (() => any) | null = null;
let running = false;
let statusMessage = "";

type Quest = any;

function getTaskName(quest: Quest): string | undefined {
    const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;

    return SUPPORTED_TASKS.find(t => taskConfig.tasks[t]);
}

function readHeartbeatProgress(quest: Quest, data: any, taskName: string): number {
    return quest.config.configVersion === 1
        ? (data.userStatus?.streamProgressSeconds ?? 0)
        : Math.floor(data.userStatus?.progress?.[taskName]?.value ?? 0);
}

async function enrollQuest(questId: string, questName: string) {
    logger.info(`Enrolling: ${questName}`);

    try {
        await RestAPI.post({ url: `/quests/${questId}/enroll` });
        await sleep(2000);
    } catch (e: any) {
        if (isCaptchaError(e)) {
            statusMessage = `Captcha needed for "${questName}" — solve it manually, then press the button again.`;
            logger.warn(`[Enroll] Captcha hit for ${questName}, leaving to user.`);

            if (settings.store.autoClickCaptcha) await tryAutoClickCaptcha();
        } else {
            logger.warn(`[Enroll] Failed for ${questName}:`, e?.message ?? e);
        }
    }
}

function isCaptchaError(e: any): boolean {
    if (!e || typeof e !== "object") return false;

    return e.status === 400 && e.body?.captcha_key != null ||
        (e.captchaFields != null && Object.keys(e.captchaFields).length > 0) ||
        e.fields?.captcha_key != null ||
        /captcha/i.test(e?.message ?? "");
}

function findCaptchaModal(): HTMLElement | null {
    for (const sel of CAPTCHA_MODAL_SELECTORS) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) return el;
    }

    return null;
}

async function tryAutoClickCaptcha(): Promise<boolean> {
    for (let attempt = 0; attempt < 10; attempt++) {
        const modal = findCaptchaModal();
        if (!modal) {
            if (attempt > 0) return true;
            await sleep(1000);
            continue;
        }

        const scope = modal instanceof HTMLIFrameElement
            ? modal.contentDocument ?? document
            : modal;

        const clickable = scope.querySelector<HTMLElement>(
            "#checkbox, . challenge-checkbox, [data-testid='checkbox'], button[type='submit'], button[class*='verify'], button[class*='submit']"
        ) ?? [...scope.querySelectorAll<HTMLElement>("button")].find(b =>
            /verify|submit|i am human|i'm not a robot/i.test(b.textContent ?? "")
        );

        clickable?.click();
        await sleep(3000);
    }

    logger.warn("[Captcha] Auto-click failed, user must solve manually.");
    return false;
}

async function enrollAllAvailable(): Promise<number> {
    if (!settings.store.autoEnroll) return 0;

    const unenrolled = [...QuestsStore.quests.values()].filter((q: Quest) =>
        !q.userStatus?.enrolledAt &&
        Date.now() < new Date(q.config.expiresAt).getTime() &&
        SUPPORTED_TASKS.some(t =>
            Object.keys((q.config.taskConfig ?? q.config.taskConfigV2).tasks).includes(t)
        )
    );

    for (const quest of unenrolled) {
        await enrollQuest(quest.id, quest.config.messages.questName);
    }

    return unenrolled.length;
}

async function claimQuestReward(quest: Quest) {
    const name = quest.config.messages.questName;

    const clicked = clickVisibleClaimButton();
    if (!clicked) {
        logger.warn(`[Claim] ${name}: no visible claim button found, user must claim manually.`);
        statusMessage = `No claim button visible for "${name}" — claim it manually.`;
        return;
    }

    logger.info(`[Claim] Clicked claim button for: ${name}`);
    await sleep(2000);

    if (isCaptchaError({ message: document.body.textContent ?? "" }) && findCaptchaModal()) {
        statusMessage = `Captcha appeared while claiming "${name}" — solve it manually.`;
        logger.warn(`[Claim] Captcha hit for ${name}, leaving to user.`);

        if (settings.store.autoClickCaptcha) await tryAutoClickCaptcha();
    }
}

function clickVisibleClaimButton(): boolean {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(b => {
        const text = (b.textContent ?? "").trim();
        if (!/^(รับรางวัล|claim( reward)?|redeem)$/i.test(text)) return false;

        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    });

    if (!buttons.length) return false;

    buttons[0].click();
    return true;
}

async function claimAllCompleted(onUpdate: () => void) {
    if (!settings.store.autoClaim) return 0;

    const claimable: Quest[] = [...QuestsStore.quests.values()].filter((q: Quest) =>
        q.userStatus?.completedAt && !q.userStatus?.claimedAt
    );

    for (const quest of claimable) {
        statusMessage = `Claiming: ${quest.config.messages.questName}`;
        onUpdate();
        await claimQuestReward(quest);
        await sleep(1000);
    }

    return claimable.length;
}

async function processVideoQuest(quest: Quest, taskName: string, target: number) {
    const name = quest.config.messages.questName;
    let progress: number = quest.userStatus?.progress?.[taskName]?.value ?? 0;
    const speed = 7;
    let completed = false;

    logger.info(`[Video] Start: ${name}`);

    while (progress < target) {
        const remaining = Math.min(speed, target - progress);
        await sleep(remaining * 1000);

        const timestamp = Math.min(target, progress + speed + Math.random());

        try {
            const res: any = await RestAPI.post({
                url: `/quests/${quest.id}/video-progress`,
                body: { timestamp },
            });
            progress = timestamp;
            completed = !!res.body.completed_at;
            statusMessage = `[Video] ${name}: ${Math.floor(progress)}/${target}s`;
            logger.info(statusMessage);
            if (completed) break;
        } catch (e: any) {
            logger.warn(`[Video] ${name} heartbeat failed:`, e?.message ?? e);
            await sleep(5000);
        }
    }

    if (!completed) {
        try {
            await RestAPI.post({
                url: `/quests/${quest.id}/video-progress`,
                body: { timestamp: target },
            });
        } catch (e: any) {
            logger.warn(`[Video] ${name} final heartbeat failed:`, e?.message ?? e);
        }
    }

    logger.info(`[Video] Done: ${name}`);
}

function createFakeGame(appData: any, applicationId: string) {
    const pid = Math.floor(Math.random() * 30000) + 1000;
    const safe = (appData.name || "UnknownGame").replace(/\s/g, "");
    const lower = safe.toLowerCase();

    return {
        id: applicationId,
        name: appData.name,
        pid,
        pidPath: [pid],
        start: Date.now(),
        exeName: `${safe}.exe`,
        exePath: `c:/program files/${lower}/${lower}.exe`,
        processName: safe,
        cmdLine: `C:\\Program Files\\${safe}\\${safe}.exe`,
        hidden: false,
        isLauncher: false,
    };
}

function dispatchGames() {
    FluxDispatcher.dispatch({
        type: "RUNNING_GAMES_CHANGE",
        removed: [],
        added: [...fakeGamesMap.values()],
        games: [...fakeGamesMap.values()],
    });
}

function hookRunningGameStore() {
    if (realGetRunningGames) return;

    realGetRunningGames = RunningGameStore.getRunningGames;
    realGetGameForPID = RunningGameStore.getGameForPID;
    realStreamMetadata = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

    RunningGameStore.getRunningGames = () => [...fakeGamesMap.values()];
    RunningGameStore.getGameForPID = (pid: number) => fakeGamesMap.get(pid);
}

function restoreAll() {
    if (realGetRunningGames) RunningGameStore.getRunningGames = realGetRunningGames;
    if (realGetGameForPID) RunningGameStore.getGameForPID = realGetGameForPID;
    if (realStreamMetadata) ApplicationStreamingStore.getStreamerActiveStreamMetadata = realStreamMetadata;

    realGetRunningGames = null;
    realGetGameForPID = null;
    realStreamMetadata = null;

    fakeGamesMap.clear();
}

async function processGameQuest(quest: Quest, taskName: string, target: number, applicationId?: string) {
    const name = quest.config.messages.questName;

    if (!applicationId) {
        logger.warn(`[Game] ${name}: no applicationId, skipping.`);
        return;
    }

    if (!isApp()) {
        logger.warn(`[Game] ${name}: requires desktop app, skipping.`);
        return;
    }

    let appData: any;

    try {
        const res: any = await RestAPI.get({
            url: `/applications/public?application_ids=${applicationId}`,
        });
        appData = res.body[0];
    } catch (e: any) {
        logger.warn(`[Game] Failed to fetch app data for ${name}:`, e?.message ?? e);
        return;
    }

    hookRunningGameStore();

    const fakeGame = createFakeGame(appData, applicationId);
    fakeGamesMap.set(fakeGame.pid, fakeGame);
    dispatchGames();

    const secondsDone: number = quest.userStatus?.progress?.[taskName]?.value ?? 0;
    logger.info(`[Game] Spoofed: ${appData.name}. Wait ${Math.ceil((target - secondsDone) / 60)} min.`);

    await new Promise<void>(resolve => {
        const onHeartbeat = (data: any) => {
            if (data.userStatus?.questId !== quest.id) return;
            const progress = readHeartbeatProgress(quest, data, taskName);
            statusMessage = `[Game] ${name}: ${progress}/${target}s`;
            logger.info(statusMessage);

            if (progress >= target) {
                fakeGamesMap.delete(fakeGame.pid);
                dispatchGames();
                FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
                logger.info(`[Game] Done: ${name}`);
                resolve();
            }
        };
        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
    });
}

async function processStreamQuest(quest: Quest, taskName: string, target: number, applicationId?: string) {
    const name = quest.config.messages.questName;

    if (!applicationId) {
        logger.warn(`[Stream] ${name}: no applicationId, skipping.`);
        return;
    }

    if (!isApp()) {
        logger.warn(`[Stream] ${name}: requires desktop app, skipping.`);
        return;
    }

    const pid = Math.floor(Math.random() * 30000) + 1000;

    if (!realStreamMetadata) realStreamMetadata = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

    ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
        id: applicationId,
        pid,
        sourceName: null,
    });

    const secondsDone: number = quest.userStatus?.progress?.[taskName]?.value ?? 0;
    logger.info(`[Stream] ${name}: spoofed. Stream any window in VC for ${Math.ceil((target - secondsDone) / 60)} min.`);
    logger.info("[Stream] Need at least 1 other person in the VC!");

    await new Promise<void>(resolve => {
        const onHeartbeat = (data: any) => {
            if (data.userStatus?.questId !== quest.id) return;
            const progress = readHeartbeatProgress(quest, data, taskName);
            statusMessage = `[Stream] ${name}: ${progress}/${target}s`;
            logger.info(statusMessage);

            if (progress >= target) {
                FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
                logger.info(`[Stream] Done: ${name}`);
                resolve();
            }
        };
        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
    });
}

async function processActivityQuest(quest: Quest, target: number) {
    const name = quest.config.messages.questName;

    const channelId: string | undefined =
        ChannelStore.getSortedPrivateChannels()[0]?.id ??
        Object.values<any>(GuildChannelStore.getAllGuilds())
            .find(x => x != null && x.VOCAL.length > 0)?.VOCAL[0]?.channel?.id;

    if (!channelId) {
        logger.warn(`[Activity] ${name}: no voice channel found, skipping.`);
        return;
    }

    const streamKey = `call:${channelId}:1`;
    logger.info(`[Activity] Start: ${name}`);

    while (true) {
        let progress: number;

        try {
            const res: any = await RestAPI.post({
                url: `/quests/${quest.id}/heartbeat`,
                body: { stream_key: streamKey, terminal: false },
            });
            progress = res.body.progress.PLAY_ACTIVITY.value;
            statusMessage = `[Activity] ${name}: ${progress}/${target}s`;
            logger.info(statusMessage);
        } catch (e: any) {
            logger.warn(`[Activity] ${name} heartbeat failed:`, e?.message ?? e);
            await sleep(20000);
            continue;
        }

        if (progress >= target) {
            try {
                await RestAPI.post({
                    url: `/quests/${quest.id}/heartbeat`,
                    body: { stream_key: streamKey, terminal: true },
                });
            } catch (e: any) {
                logger.warn(`[Activity] ${name} terminal heartbeat failed:`, e?.message ?? e);
            }
            break;
        }

        await sleep(20000);
    }

    logger.info(`[Activity] Done: ${name}`);
}

async function processQuest(quest: Quest) {
    const name = quest.config.messages.questName;
    const taskName = getTaskName(quest);
    if (!taskName) return;

    const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
    const taskData = taskConfig.tasks[taskName];
    const { target } = taskData;
    const applicationId: string | undefined = quest.config.application?.id ?? taskData.applications?.[0]?.id;

    if (!quest.userStatus?.enrolledAt) await enrollQuest(quest.id, name);

    if (taskName.includes("WATCH_VIDEO")) await processVideoQuest(quest, taskName, target);
    else if (taskName === "PLAY_ON_DESKTOP") await processGameQuest(quest, taskName, target, applicationId);
    else if (taskName === "STREAM_ON_DESKTOP") await processStreamQuest(quest, taskName, target, applicationId);
    else if (taskName === "PLAY_ACTIVITY") await processActivityQuest(quest, target);
}

async function runAllQuests(onUpdate: () => void) {
    if (running) return;
    running = true;
    onUpdate();

    try {
        hookRunningGameStore();

        const enrolled = await enrollAllAvailable();
        if (enrolled) {
            statusMessage = `Enrolled ${enrolled} quest(s).`;
            onUpdate();
        }

        const pending: Quest[] = [...QuestsStore.quests.values()].filter(q =>
            !q.userStatus?.completedAt &&
            Date.now() < new Date(q.config.expiresAt).getTime() &&
            SUPPORTED_TASKS.some(t =>
                Object.keys((q.config.taskConfig ?? q.config.taskConfigV2).tasks).includes(t)
            )
        );

        if (!pending.length) {
            statusMessage = "No pending quests.";
            logger.info("[QuestManager] No pending quests.");
            return;
        }

        const streamQuests = pending.filter(q => getTaskName(q) === "STREAM_ON_DESKTOP");
        const otherQuests = pending.filter(q => getTaskName(q) !== "STREAM_ON_DESKTOP");

        logger.info(`[QuestManager] ${pending.length} quest(s) found.`);
        statusMessage = `${pending.length} quest(s) found. Running...`;
        onUpdate();

        await Promise.all([
            ...otherQuests.map(processQuest),
            (async () => {
                for (const q of streamQuests) await processQuest(q);
            })(),
        ]);

        const claimed = await claimAllCompleted(onUpdate);

        statusMessage = claimed
            ? `All quests done. Claimed ${claimed} reward(s).`
            : "All quests done.";
        logger.info("[QuestManager] All quests done.");
    } finally {
        restoreAll();
        running = false;
        onUpdate();
    }
}

let reactRoot: Root | null = null;

function getRoot() {
    if (!reactRoot) {
        const host = document.createElement("div");
        host.id = "vc-quest-completer-host";
        document.body.appendChild(host);
        reactRoot = createRoot(host);
    }

    return reactRoot;
}

function isOnQuestHome(): boolean {
    return window.location.pathname === QUEST_HOME_PATH ||
        window.location.hash.includes(QUEST_HOME_PATH) ||
        window.location.href.includes("quest-home");
}

function QuestButton() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [visible, setVisible] = React.useState(isOnQuestHome());

    React.useEffect(() => {
        const onNavigate = () => setVisible(isOnQuestHome());
        const interval = setInterval(onNavigate, 1000);
        window.addEventListener("popstate", onNavigate);

        return () => {
            clearInterval(interval);
            window.removeEventListener("popstate", onNavigate);
        };
    }, []);

    if (settings.store.showOnQuestHomeOnly && !visible) return null;

    return (
        <button
            className="vc-quest-completer-btn"
            disabled={running}
            onClick={() => runAllQuests(forceUpdate)}
            type="button"
        >
            {running ? (statusMessage || "Running...") : "Complete Quests"}
        </button>
    );
}

export default definePlugin({
    name: "QuestCompleter",
    description: "Adds a button on Quest Home to auto-complete Discord quests (video, play, stream, activity)",
    authors: [{ name: "Knuxy92 (ported)", id: 0n }],
    settings,

    start() {
        const style = document.createElement("style");
        style.id = "vc-quest-completer-style";
        style.textContent = `
.vc-quest-completer-btn {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 9999;
    background: #000;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 12px 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
}
.vc-quest-completer-btn:disabled {
    opacity: 0.7;
    cursor: wait;
}
.vc-quest-completer-btn:not(:disabled):hover {
    background: #222;
}`;

        document.head.appendChild(style);
        getRoot().render(<QuestButton />);
    },

    stop() {
        reactRoot?.render(null);
        reactRoot = null;
        document.getElementById("vc-quest-completer-host")?.remove();
        restoreAll();
    }
});
