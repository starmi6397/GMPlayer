import { invoke } from "@tauri-apps/api/core";

export { windowManager, isTauri } from "./windowManager";
export type { WindowConfig, WindowLabel, WindowState } from "./types";
export { usePlayerBridge } from "./playerBridge";
export type {
  PlayerStatePayload,
  PlayerTimePayload,
  PlayerLyricPayload,
  PlayerSettingsPayload,
} from "./playerBridge";
export function isMobile(): boolean {
  let result = false;
  invoke<boolean>("detect_desktop").then((val) => {
    result = val;
  });
  return result;
}
