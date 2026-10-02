import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

const config = defineConfig({
  fmt: {
    ignorePatterns: ["src/routeTree.gen.ts", "bun.lock"],
    printWidth: 90,
    sortImports: {},
    sortTailwindcss: {
      functions: ["cn", "cva"],
      stylesheet: "./src/global.css",
    },
  },
  lint: {
    categories: {
      correctness: "error",
      perf: "error",
      suspicious: "error",
    },
    ignorePatterns: [
      "src/routeTree.gen.ts",
      "src/shared/components/ui/**",
      "src/shared/hooks/use-mobile.ts",
    ],
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: true,
    },
    plugins: ["typescript", "unicorn", "oxc", "react", "import", "jsx-a11y"],
    rules: {
      "import/no-cycle": "error",
      "import/no-duplicates": "error",
      "jsx-a11y/control-has-associated-label": "off",
      "jsx-a11y/heading-has-content": "off",
      "react/react-in-jsx-scope": "off",
    },
  },
  resolve: { tsconfigPaths: true },
  plugins: lazyPlugins(() => [tailwindcss(), tanstackStart(), viteReact()]),
});

export default config;
