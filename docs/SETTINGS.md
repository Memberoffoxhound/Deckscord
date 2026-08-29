# QAM Settings tree

Home → **Settings**. Mapped from Vesktop’s Settings tab plus Discord
MediaEngine flags we can actually set over CDP.

```
Settings
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
processing is live via MediaEngine. Deckscord talking-overlay prefs live in
`~/.local/share/deckscord/settings.json`.
