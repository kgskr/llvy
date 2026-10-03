import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".claude/**",
      ".codex/**",
      ".next/**",
      "node_modules/**",
      "openspec/**",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
