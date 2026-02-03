# Script.js

This script is designed to **automate and accelerate Discord Quests progression** (such as WATCH_VIDEO and PLAY_ON_DESKTOP) by hooking into Discord’s internal webpack modules and simulating the required activities.

> ⚠️ **Important Warning**: Scripts of this nature may violate Discord’s Terms of Service. This project is provided **for educational and research purposes only**. Use at your own risk.

---

## Features

* Automatically detects active quests that are not yet completed and not expired
* Auto-enrolls quests if not already enrolled
* Supports the following quest task types:

  * `WATCH_VIDEO`
  * `WATCH_VIDEO_ON_MOBILE`
  * `PLAY_ON_DESKTOP`
  * `STREAM_ON_DESKTOP`
* Simulates video watch progress via API calls
* Simulates desktop gameplay by injecting fake running game processes
* Processes multiple quests sequentially with a staggered delay to reduce conflicts

---

## File

* **Script.js** – Main automation script

---

## How It Works (High-Level)

1. Injects into Discord’s webpack runtime to access internal stores and APIs
2. Locates quest, running game, and streaming stores dynamically (supports multiple export layouts)
3. Filters eligible quests based on status, expiration, and supported task types
4. Enrolls quests automatically if required
5. Progresses quests by:

   * Periodically sending video progress timestamps for video-based quests
   * Creating and dispatching fake running game data for desktop play quests
6. Monitors quest heartbeat events to determine completion

---

## Supported Tasks

| Task Type             | Method                             |
| --------------------- | ---------------------------------- |
| WATCH_VIDEO           | Sends `/video-progress` timestamps |
| WATCH_VIDEO_ON_MOBILE | Same as WATCH_VIDEO                |
| PLAY_ON_DESKTOP       | Injects fake running game process  |
| STREAM_ON_DESKTOP     | Uses active stream metadata        |

---

## Usage

1. Open **Discord Desktop App** (recommended)
2. Open **Developer Tools** (Ctrl + Shift + I)
3. Go to the **Console** tab
4. Paste the contents of `Script.js`
5. Press **Enter** and let the script run

The console will display real-time quest progress and completion logs.

---

## Logs Example

```
[QuestManager] Found 2 active quests. Starting staggered processing...
[Video] Started: Watch a Trailer
[Video] Watch a Trailer: 14/60s
[Video] Completed: Watch a Trailer
[Game] Started: Play Game X
[Game] Play Game X: 120/120s
[Game] Completed: Play Game X
```

---

## Notes

* Progress timing includes small randomization to reduce detection patterns
* Fake game processes are removed immediately after quest completion
* Script assumes Discord internal APIs and store structures may change at any time

---

## Disclaimer

This repository is **not affiliated with or endorsed by Discord**. The author is not responsible for any account actions, bans, or losses resulting from the use of this script.
