# Deckscord QAM menu tree

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
   ├─ Voice strip               (hidden on Chat / Member)
   │  ├─ People in call
   │  │  └─ row A → Member mixer
   │  ├─ Leave voice
   │  ├─ Share game / Stop sharing   (720p Go Live; Game Recording must be off)
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
   │  ├─ Messages (timestamps, d-pad scroll)
   │  │  └─ A on picture/video → overlay; B closes overlay and stays in this chat
   │  ├─ Message field + Send   (Steam keyboard)
   │  ├─ Start voice call       (DMs only)
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
   └─ Settings
      ├─ Discord · Voice        mute, devices, echo / noise / AGC
      ├─ Vesktop · Performance  hardware accel (restart)
      ├─ Vesktop · Linux audio  venmic flags
      └─ Vesktop · App          branch, tray, arRPC, WebRTC IP
```
