# QuestCompleter — Vencord Plugin

A Vencord port of the [`Script.js`](../Script.js) userscript in this repo. Instead of pasting code into DevTools, it adds a button to the Discord client that accepts, completes and claims quests in one click.

> [!NOTE]
> `PLAY_ON_DESKTOP` and `STREAM_ON_DESKTOP` quests require the Discord **Desktop app**. They are skipped in the browser build.

---

## Install

Custom plugins live in `src/userplugins`, which is only bundled when you build Vencord yourself — the official installer build does not include them.

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
```

Copy the plugin folder into the Vencord checkout:

```
Vencord/src/userplugins/questCompleter/index.tsx
```

Then build and inject:

```bash
pnpm install
pnpm build
pnpm inject
```

Restart Discord and enable **QuestCompleter** in `Settings → Plugins`.

---

## Usage

Open the Quests page (`https://discord.com/quest-home`). A black button labelled **Complete Quests** appears in the bottom-right corner — it is hidden on every other page.

Pressing it runs three phases in order:

1. **Enroll** — accepts every available quest that is not enrolled yet.
2. **Complete** — runs all quest tasks. Video and activity quests run in parallel; stream quests are serialized because only one can be active at a time.
3. **Claim** — claims the reward for every completed but unclaimed quest.

The button shows live progress (current quest, seconds done, claim status) and is disabled while a run is in progress. Quests that were already completed before you pressed the button are claimed as well.

---

## Settings

| Setting               | Default | Description                                                                          |
| --------------------- | ------- | ------------------------------------------------------------------------------------ |
| `showOnQuestHomeOnly` | `true`  | Show the button only on the Quest Home page. Turn off to keep it visible everywhere. |
| `autoEnroll`          | `true`  | Auto-accept all available quests before completing.                                  |
| `autoClaim`           | `true`  | Auto-claim rewards for completed quests. Turn off to claim manually.                 |
| `autoClickCaptcha`    | `true`  | Try to click the captcha checkbox / verify button automatically.                     |

---

## Supported task types

| Task                    | Platform          |
| ----------------------- | ----------------- |
| `WATCH_VIDEO`           | Browser / Desktop |
| `WATCH_VIDEO_ON_MOBILE` | Browser / Desktop |
| `PLAY_ACTIVITY`         | Browser / Desktop |
| `PLAY_ON_DESKTOP`       | Desktop only      |
| `STREAM_ON_DESKTOP`     | Desktop only      |

---

## How it works

- Stores are resolved by module shape through Vencord's webpack API (`getQuest` + `quests` map for the quest store), the same way the userscript probes modules by hand.
- Progress is driven by the official quest endpoints (`/enroll`, `/video-progress`, `/heartbeat`) plus spoofed running-game / stream metadata for desktop tasks.
- **Rewards are claimed by clicking the real claim button in the UI.** Discord rejects a direct `POST /quests/:id/claim-reward` with `403 code 10008` unless it carries ad-decision metadata that only the client can produce, so the plugin clicks the button a user would click.
- **Captcha is not solved for you.** If Discord returns a captcha challenge on enroll or claim, the plugin tries to click the challenge checkbox/verify button a few times; if that fails, the status text on the button names the quest and you finish it manually.

---

## Troubleshooting

- **Button missing** — the plugin only shows on `/quest-home`; check `showOnQuestHomeOnly`. If it is missing there too, confirm the plugin is enabled and Vencord was rebuilt after copying the folder.
- **Nothing happens / store not found** — Discord updates rename or reshape modules. Open DevTools (`Ctrl+Shift+I`) and look for `QuestCompleter` errors in the console.
- **Claim does nothing** — the claim button is matched by its label, currently English and Thai (`รับรางวัล`). Other client languages are not matched; claim manually or add the label to `clickVisibleClaimButton`.
- **Stream quest stalls** — you need at least one other person in the voice channel.
- **Activity quest skipped** — no voice channel was found to attach the heartbeat to.

Logs are written to the console with the `QuestCompleter` tag, e.g. `[Video] Quest name: 42/85s`, `[Claim] Clicked claim button for: ...`.

---

## Credit

- Ported from [Knuxy92/completer-discord-quest](https://github.com/Knuxy92/completer-discord-quest)
- Base script: [aamiaa](https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb#file-completediscordquest-md)

## Disclaimer

Use at your own risk — automating Discord quests may violate [Discord's Terms of Service](https://discord.com/terms).
The author is not responsible for any account actions taken by Discord.

## License

GPL-3.0 — see [../LICENSE](../LICENSE).
