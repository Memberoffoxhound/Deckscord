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
 * A on a picture or video opens a Watch-style overlay. B closes the overlay
 * and stays in that chat. Thumbs are 240px webp; the video file loads in the overlay.
 * Messages show timestamps and d-pad-scroll in the thread pane.
 * B / onCancel pops the view stack until home, then QAM closes.
 *
 * Live video: WebRTC tiles at 30fps (JPEG thumbs only as fallback).
 * A on a tile focuses that inbound stream and pins a PiP stamp over the game.
 * Stop watching unfocuses and unpins. Who's-talking is a separate GTK overlay.
 * Settings hub maps Vesktop settings.json + MediaEngine voice flags.
 */
export {};
