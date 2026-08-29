# Watch overlay (Switch 2 GameShare *as a spectator*, not a clone)

End state: you are in a game on the handheld, a friend is Go Live in the same
Discord call, you press A on their tile, and their gameplay fills a large
overlay with **their game audio**. Party voice stays. B closes the overlay.

That is the **watch** half of Nintendo Switch 2 GameChat/GameShare, using
Discord/Vesktop as the pipe we already have. It is not Nintendo GameShare.

## Legal / ToS (not legal advice)

This is a product constraint, not a slogan.

### What we are building (allowed as a Discord user feature)

You joined a Discord voice channel. A friend used **Go Live / Screen Share**
to send their game to that channel. Discord’s own desktop overlay already
lets you **watch** that stream while playing. We show the same consented
stream on this handheld: local display + local speakers. We do not copy the
bytes off Discord’s network to a third party.

Discord’s terms say Go Live is how you “stream what you’re doing” to people
in the call. Watching it is the other half of that feature.

### What we will not build (copyright / Nintendo / Discord)

| Don’t | Why |
|---|---|
| Guest-**play** a commercial game the watcher doesn’t own (Switch GameShare’s “one copy, everyone plays”) | That’s Nintendo’s licensed feature. Streaming someone else’s game as a playable session to people without a license is a copyright/EULA problem. We are spectator-only. |
| Record, save, or rebroadcast a Go Live outside the call | Other people’s content; Discord ToS “other people’s content” + copyright. |
| Relay the stream to users who are not in the Discord channel | Bypasses Discord’s viewer list and the streamer’s consent. |
| Use Nintendo, GameShare, or Discord marks in the UI | Trademark. The button is **Watch**. |
| Raise quality past what Discord granted the account (Nitro caps) | Circumventing a paid limit. Default stays 720p30. |
| Self-bots, scrapers, token export | Discord ToS: no unauthorized automation that harms the service. |

### Honest gray area (already true of Deckscord)

Discord forbids “unauthorized software designed to modify the services” and
client mods. **Vesktop is already that.** Deckscord driving Vesktop over CDP
does not become illegal because we add a bigger watch view, but it also does
not become officially supported. Same account-risk as using Vesktop at all.
We stay a **viewer UI** for a session the user is in — we don’t scrape, spam,
or resell.

## UX (end state)

```
In a call, friend is live
        │
        ▼
  QAM tile (small, silent)     ← everyone who is live, no game audio
        │  A
        ▼
  WATCH overlay (large)        ← that friend’s game, 16:9, game audio ON
        │  B
        ▼
  back to your game            ← stream audio OFF, party voice still there
```

- **Tiles:** video only. No stream audio until you Watch.
- **Watch:** one focused stream, large, game audio for that user only at **30% of output volume** (slider to change).
- **Party mics:** still audible unless you Mute/Deafen/Solo on the member page.
- **Your game:** stays running under the overlay (Steam/gamescope). Overlay is
  a spectator layer, not a second gamescope session of their title.

## Pipe

Same as today: Vesktop MediaEngine after `STREAM_WATCH` → JPEG (or later a
local WebRTC/MSE overlay) into Steam CEF. Audio is Discord’s stream track
(`setLocalVolume(userId, vol, "stream")`), not the voice mic path and not a
desktop monitor.

Focused Watch grabs a larger JPEG (~960×540). Other tiles stay cheap.

## PiP stamp

Pin from Watch or from the focused tile. A gamescope external overlay
window (`plugin/pip_overlay.py`) draws one JPEG stamp in a corner after the
QAM closes. Audio stays in Discord (`focusStream`) — the overlay is pixels
only.

The overlay process refuses to map unless gamescope is the session (no
KWin) and the X display interned `GAMESCOPE_*` atoms. A fullscreen GTK
window on desktop `:0` covers login and steals Steam's QAM / Steam-button
layer — it is not started there. Who's-talking is off until you enable it.

Small = 240p (426×240), large = 480p (854×480), both clamped to a fraction
of output height so a Deck and a 4K panel stay usable. Opacity is
compositor alpha.

## Later

- Hardware-decoded overlay if JPEG cannot hold 30 fps.
- Multiple PiP windows. Still spectator-only.
