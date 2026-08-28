# QAM Settings tree

Home → **Settings**. Mapped from Vesktop’s Settings tab plus Discord
MediaEngine flags we can actually set over CDP.

```
Settings
├─ Picture in picture
│  ├─ Stamp size     small 240p / large 480p (height-clamped)
│  ├─ Corner         top-left / top-right / bottom-left / bottom-right
│  ├─ Opacity        20–100% compositor alpha
│  └─ Unpin
├─ Who's talking
│  ├─ Enable         names over the game while someone speaks
│  ├─ Corner / size / opacity
│  └─ Show me
├─ Discord · Voice
│  ├─ Mute / Deafen
│  ├─ Input / output devices
│  ├─ Echo cancellation
│  ├─ Noise suppression
│  ├─ Noise cancellation (Krisp if present)
│  └─ Automatic gain
├─ Discord · Go Live
│  ├─ Resolution     720 / 1080  → Vesktop State.screenshareQuality
│  └─ Frame rate     15 / 30
├─ Vesktop · Performance     (~/.config/vesktop/settings.json)
│  ├─ Hardware acceleration          restart Vesktop
│  ├─ Video hardware acceleration    restart Vesktop
│  └─ Disable smooth scrolling
├─ Vesktop · Linux audio     Settings.store.audio (venmic)
│  ├─ Microphone workaround
│  ├─ Ignore input media
│  ├─ Ignore virtual nodes
│  ├─ Ignore devices
│  ├─ Granular selection
│  ├─ Device selection
│  ├─ Only speakers
│  └─ Only default speakers
└─ Vesktop · App
   ├─ Discord branch         stable / canary / ptb  (restart)
   ├─ Tray / minimize to tray / tray click
   ├─ Rich Presence (arRPC)
   ├─ Open links in app
   ├─ Native titlebar / static title / menu / splash
   └─ WebRTC IP handling
```

Vesktop booleans are written to `settings.json` (Flatpak:
`~/.var/app/dev.vencord.Vesktop/config/vesktop/settings.json`). Hardware
acceleration and branch apply on the next Vesktop start. Discord voice
processing is live via MediaEngine. Deckscord PiP prefs live in
`~/.local/share/deckscord/settings.json`.
