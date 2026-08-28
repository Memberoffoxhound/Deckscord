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
 * B / onCancel pops the view stack until home, then QAM closes.
 * Chat puts messages first (no nested scroller) so the thread sits in
 * the upper half of the QAM and d-pad can move through it.
 */
export {};
