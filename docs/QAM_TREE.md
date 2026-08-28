# Deckscord QAM menu tree

Snapshot of the current Quick Access Menu so we can flatten it tomorrow.
B pops one level until **Servers**; B on Servers closes the QAM.

```
Deckscord
│
├─ [not ready]
│  ├─ Status light + phase label
│  └─ Scan to log in
│     ├─ QR image
│     └─ Start Discord          (only if Vesktop failed)
│
└─ [ready]
   │
   ├─ Status
   │  ├─ phase label
   │  ├─ Back                   (any nested page)
   │  ├─ Settings ──────────────► Settings hub
   │  └─ Update from GitHub     (home only; until Decky store)
   │
   ├─ Voice strip               (hidden on Chat / Member / Live video)
   │  ├─ Live tiles             (only if someone has camera or Go Live)
   │  │  └─ tile A: focus stream (game audio); A again: large Watch overlay
   │  │     B on Watch: close overlay, mute stream audio, party voice stays
   │  ├─ People in call         (no duplicate of anyone already on a tile)
   │  │  └─ row A → Member mixer
   │  ├─ Share game             (720p 30 Go Live; game screen + game audio)
   │  ├─ Leave voice
   │  ├─ Mute
   │  ├─ Deafen
   │  ├─ Output volume
   │  ├─ Input volume
   │  └─ Input / output devices → Devices
   │
   ├─ Servers                   (home)
   │  ├─ Direct Messages ──────► DMs
   │  └─ [each server] ────────► Server
   │
   ├─ DMs
   │  └─ [conversation] ───────► Chat (isDm)
   │
   ├─ Server
   │  ├─ Text
   │  │  └─ #channel ──────────► Chat
   │  └─ Voice
   │     ├─ 🔊 channel          (join, stay here)
   │     └─ people in that VC ─► Member mixer
   │
   ├─ Chat  (#channel or DM)
   │  ├─ Messages (top of QAM)
   │  ├─ Message field + Send   (Steam keyboard)
   │  ├─ Start voice call       (DMs only)
   │  ├─ Live video (N) ───────► Live video
   │  └─ Leave voice            (if connected)
   │
   ├─ Member mixer
   │  ├─ Volume (for you)
   │  ├─ Mute for me
   │  ├─ Solo this user
   │  ├─ Mute on server
   │  └─ Deafen on server
   │
   ├─ Devices
   │  ├─ Input list
   │  └─ Output list
   │
   ├─ Live video
   │  ├─ Tiles (max 4, edge-to-edge)
   │  ├─ Pin focused stream to corner
   │  ├─ Leave / Mute / Deafen
   │  └─ overflow people as placeholders
   │
   └─ Settings
      ├─ Picture in picture     corner / small 240p / large 480p / opacity
      ├─ Who's talking          names over the game, corner / size / opacity
      ├─ Discord · Voice        mute, devices, echo / noise / AGC
      ├─ Discord · Go Live      720/1080 · 15/30 (Vesktop screenshareQuality)
      ├─ Vesktop · Performance  hardware accel (restart)
      ├─ Vesktop · Linux audio  venmic flags
      └─ Vesktop · App          branch, tray, arRPC, WebRTC IP
```

## What feels heavy today

- Voice strip + Servers on the same home page: people, leave/mute/deafen, two sliders, devices, then the server list.
- Chat hides the voice strip and only offers Leave + Live video at the bottom.
- Member mixer is a full page for one person.
- Live video is a second page even though tiles already sit on home.

## Leaner tree to try tomorrow

```
Deckscord
├─ People (in call)     tiles + one row per user, 🔊 speaks, A opens a thin mixer
├─ Call bar             Leave · Mute · Deafen   (one row, always)
└─ Browse
   ├─ Servers → channels → chat
   └─ DMs → chat
```

Keep Devices and sliders behind a single “Audio” row. Keep server mute/deafen inside the mixer, not on the call bar.
