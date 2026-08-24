// Deckscord Decky frontend (skeleton)
// Expand into full React + @decky/ui components.
// This file is loaded by Decky Loader as the plugin UI.

(function() {
  "use strict";

  // Minimal content panel so the plugin appears and is usable immediately.
  // Real implementation should use React + decky-frontend-lib / @decky/ui
  // with tabs for Voice / Text / Settings, live member list, volume sliders, etc.

  const root = document.createElement("div");
  root.id = "deckscord-root";
  root.style.cssText = "padding:12px;font-family:var(--steam-font,sans-serif);color:#fff;";

  root.innerHTML = `
    <h2 style="margin:0 0 8px 0;">Deckscord</h2>
    <p style="opacity:0.8;margin:0 0 12px 0;">Discord companion for Game Mode</p>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button id="dsc-voice" style="flex:1;padding:8px;">Voice</button>
      <button id="dsc-text" style="flex:1;padding:8px;">Text</button>
      <button id="dsc-settings" style="flex:1;padding:8px;">Settings</button>
    </div>
    <div id="dsc-panel" style="min-height:180px;background:rgba(0,0,0,0.25);border-radius:8px;padding:12px;">
      <p>Loading status…</p>
    </div>
    <p style="font-size:11px;opacity:0.6;margin-top:12px;">
      Backend manages Vesktop. Full CDP-driven channel list, per-user volume, speaking overlay and toasts ship in the next iterations.
    </p>
  `;

  // Decky mounts plugins into a container; we append for now.
  const target = document.getElementById("root") || document.body;
  target.appendChild(root);

  const panel = document.getElementById("dsc-panel");

  function showVoice() {
    panel.innerHTML = `
      <h3 style="margin-top:0;">Voice</h3>
      <p>Join / leave channels and control volumes from here.</p>
      <ul style="list-style:none;padding:0;">
        <li style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
          <strong>General</strong> <button style="float:right;">Join</button>
        </li>
        <li style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
          <strong>Lobby</strong> <button style="float:right;">Join</button>
        </li>
      </ul>
      <p style="font-size:12px;opacity:0.7;">Per-user volume (0–200%) and local mute will appear once the live member list is connected via CDP.</p>
    `;
  }

  function showText() {
    panel.innerHTML = `
      <h3 style="margin-top:0;">Text</h3>
      <p>Channel messages, GIFs, images and video playback will live here.</p>
      <textarea placeholder="Message…" style="width:100%;height:60px;background:#111;color:#fff;border:1px solid #333;border-radius:4px;"></textarea>
      <button style="margin-top:8px;">Send</button>
    `;
  }

  function showSettings() {
    panel.innerHTML = `
      <h3 style="margin-top:0;">Settings</h3>
      <label style="display:block;margin:8px 0;">
        <input type="checkbox" id="dsc-overlay" checked> Speaking overlay
      </label>
      <label style="display:block;margin:8px 0;">
        <input type="checkbox" id="dsc-toasts" checked> Toast notifications
      </label>
      <label style="display:block;margin:8px 0;">
        <input type="checkbox" id="dsc-joinleave" checked> Notify when users join / leave voice
      </label>
      <p style="font-size:12px;opacity:0.7;">Audio device selection and screen-share / PiP options will appear here.</p>
    `;
  }

  document.getElementById("dsc-voice").onclick = showVoice;
  document.getElementById("dsc-text").onclick = showText;
  document.getElementById("dsc-settings").onclick = showSettings;

  showVoice();

  // Try to call backend status if Decky bridge is present
  if (window.DeckyPluginLoader || window.callServerMethod) {
    // Future: window.callServerMethod("get_status").then(...)
  }
})();
