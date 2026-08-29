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
 * mixer with volume, local mute, server mute/deafen, and Solo.
 *
 * Chat packs attachments, embeds, gifv, stickers (images + video).
 * A on a picture or video opens a media overlay. B closes the overlay
 * and stays in that chat. Thumbs are 240px webp; the video file loads in the overlay.
 * Messages show timestamps and d-pad-scroll in the thread pane.
 * B / onCancel pops the view stack until home, then QAM closes.
 *
 * Chat and voice, plus outbound Share game (gamescope PipeWire → Discord
 * Go Live at 720p). No inbound live-call video tiles, Watch overlay, or
 * who's-talking names over the game (parked).
 * Settings hub maps Vesktop settings.json + MediaEngine voice flags.
 */
export {};
