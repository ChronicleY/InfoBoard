import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  globalIgnores(["dist/**", ".output/**", ".wxt/**"]),
]);

export default eslintConfig;
