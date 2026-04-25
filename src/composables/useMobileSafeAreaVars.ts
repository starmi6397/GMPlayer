import { isTauri, isMobile } from "@/utils/tauri";

const PLATFORM_VARS: Record<"tauri-mobile" | "default", Record<string, string>> = {
  "tauri-mobile": {
    "--app-safe-area-top": "env(safe-area-inset-top)",
    "--app-safe-area-bottom": "env(safe-area-inset-bottom)",
    "--app-safe-area-left": "env(safe-area-inset-left)",
    "--app-safe-area-right": "env(safe-area-inset-right)",
  },
  default: {
    "--app-safe-area-top": "0px",
    "--app-safe-area-bottom": "0px",
    "--app-safe-area-left": "0px",
    "--app-safe-area-right": "0px",
  },
};

export async function useMobileSafeAreaVars() {
  const platform = isTauri() && (await isMobile()) ? "tauri-mobile" : "default";
  const vars = PLATFORM_VARS[platform];

  Object.entries(vars).forEach(([key, val]) => {
    document.documentElement.style.setProperty(key, val);
  });
}
