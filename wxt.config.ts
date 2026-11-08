import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/postcss";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifestVersion: 3,
  srcDir: ".",
  entrypointsDir: "entrypoints",
  outDir: "dist",
  manifest: {
    name: "SZU 公文通助手",
    description: "深圳大学公文通分类浏览助手",
    permissions: ["storage", "alarms", "cookies", "offscreen", "unlimitedStorage", "sidePanel"],
    action: {},
    side_panel: {
      default_path: "sidepanel.html",
    },
    host_permissions: [
      "https://www1.szu.edu.cn/*",
    ],
    options_ui: {
      open_in_tab: true,
    },
  },
  vite: () => ({
    css: {
      postcss: {
        plugins: [tailwindcss()],
      },
    },
  }),
});
