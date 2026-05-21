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
    permissions: ["storage", "alarms", "cookies"],
    host_permissions: [
      "https://www1.szu.edu.cn/*",
      "https://api.deepseek.com/*",
    ],
    options_ui: {
      open_in_tab: true,
    },
    icons: {
      16: "icon-48.svg",
      48: "icon-48.svg",
      128: "icon-128.svg",
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
