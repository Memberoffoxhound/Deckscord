/**
 * Deckscord frontend source (TypeScript / React)
 * Build this into dist/index.js with the Decky plugin build pipeline.
 *
 * Target UI (PS5 / Xbox inspired):
 * - Top tabs: Voice | Text | Settings
 * - Shared Servers / DMs switch
 * - Voice: live members with speaking ring, per-user volume 0-200%, local mute
 * - Text: message list + composer (text, GIF, image, video)
 * - Settings: overlay, toasts, join/leave alerts, devices, screen share
 * - Optional floating speaking overlay + PiP streams
 */

import { definePlugin, PanelSection, PanelSectionRow, ButtonItem, ToggleField, SliderField } from "@decky/ui";
// @ts-ignore – decky runtime
import { call } from "@decky/api";

export default definePlugin(() => {
  return {
    title: <div>Deckscord</div>,
    content: <DeckscordPanel />,
    icon: <span>💬</span>,
  };
});

function DeckscordPanel() {
  // Placeholder – real implementation will use React state + call("get_status") etc.
  return (
    <>
      <PanelSection title="Deckscord">
        <PanelSectionRow>
          <div>Voice · Text · Settings</div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Speaking overlay"
            checked={true}
            onChange={() => call("set_setting", "overlay_enabled", true)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Toast notifications"
            checked={true}
            onChange={() => call("set_setting", "toasts_enabled", true)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Join / leave alerts"
            checked={true}
            onChange={() => call("set_setting", "join_leave_notify", true)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label="Master volume"
            value={100}
            min={0}
            max={200}
            step={1}
            onChange={(v) => call("set_setting", "master_volume", v)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem onClick={() => call("leave_voice")}>
            Leave voice channel
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}
