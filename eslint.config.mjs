import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import { getDefaultSelectors } from "eslint-plugin-better-tailwindcss/api/defaults";
import {
  MatcherType,
  SelectorKind,
} from "eslint-plugin-better-tailwindcss/api/types";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": {
        cwd: import.meta.dirname,
        entryPoint: "app/globals.css",
        selectors: [
          ...getDefaultSelectors(),
          {
            kind: SelectorKind.Variable,
            name: ".*[Cc]lass(?:es|Names?)?$",
            match: [{ type: MatcherType.String }],
          },
        ],
      },
    },
    rules: {
      "better-tailwindcss/enforce-canonical-classes": "error",
      "better-tailwindcss/no-conflicting-classes": "error",
    },
  },
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
