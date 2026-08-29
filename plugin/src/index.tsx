/**
 * Source sketch for the QAM UI.
 * Shipped frontend is plugin/dist/index.js (SP_REACT + DFL).
 *
 * Native Decky/Steam controls: PanelSection, ButtonItem, ToggleField,
 * SliderField, TextField. TextField is wrapped in Focusable so A/click
 * opens the Steam keyboard; the composer sits at the top of chat so it
 * stays visible above the keyboard.
 *
 * Voice: Leave / mute / deafen / volume sliders live in a Voice section
 * at the top of every page (gamepad-reachable). Per-user 🔊 opens a
 * mixer with volume, local mute, server mute/deafen.
 *
 * Chat packs attachments, embeds, gifv, stickers (images + video).
 * A on a picture or video opens a Watch-style overlay (B closes).
 * Messages show timestamps and d-pad-scroll in the thread pane.
 * B / onCancel pops the view stack until home, then QAM closes.
 *
 * Live video: edge-to-edge JPEG tiles (VideoStack first in voice),
 * exclusive local-mute on tile A, 🔊 pill on the focused stream.
 * Member-row A still opens the mixer; Solo is a ToggleField there.
 * Pin to corner starts pip_overlay.py on gamescope's overlay plane (Game Mode only).
 * Stop watching under the tile unfocuses and unpins. A on a tile opens Watch.
 * Who's-talking roster uses the same overlay (speakers only, avatar + name). Off by default.
 * Settings hub maps Vesktop settings.json + MediaEngine voice flags.
 */
export {};
