# Historical: AI-01 Cloudflare Worker and React Scaffold Implementation Plan

> **Superseded:** This plan describes the original scaffold. The current product is documented in `docs/specs/cronup-alpha.md`; this file remains as build history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal single-package Cloudflare Worker, Hono, React, Vite, and split-runtime test foundation required by CronUp AI-01.

**Architecture:** One root npm project builds a React SPA and a Hono Worker through the official Cloudflare Vite plugin. Worker tests run in workerd through Cloudflare's Vitest integration, while component tests run independently in jsdom.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, React, Vite, Wrangler, Vitest 4.1+, Testing Library

**Source spec:** `docs/superpowers/specs/2026-08-20-ai-01-cloudflare-react-scaffold-design.md`

---

## File map

- `package.json` and `package-lock.json`: commands and reproducible dependency graph.
- `vite.config.ts`: combined React and Cloudflare build.
- `vitest.worker.config.ts`: workerd test runtime and D1 migration discovery.
- `vitest.app.config.ts` and `test/setup.ts`: jsdom component-test runtime.
- `wrangler.jsonc`: Worker entrypoint, draft D1, assets, and Cron bindings.
- `worker/env.ts` and `worker/index.ts`: binding types and Worker entrypoints.
- `src/main.tsx`, `src/App.tsx`, and `src/styles.css`: minimal browser shell.
- `test/scaffold.worker.test.ts` and `test/scaffold.app.test.tsx`: Worker and React smoke tests.

### Task 1: Create the toolchain and platform configuration

**Files:**
- Create: `package.json`, `package-lock.json`, `index.html`
- Create: `tsconfig.json`, `tsconfig.app.json`, `tsconfig.worker.json`
- Create: `vite.config.ts`, `vitest.worker.config.ts`, `vitest.app.config.ts`
- Create: `test/tsconfig.json`, `test/setup.ts`, `migrations/.gitkeep`
- Create: `wrangler.jsonc`
- Create or modify: `.gitignore`

- [ ] **Step 1: Create the minimal npm manifest**

```json
{
  "name": "cronup",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "npm run test:worker && npm run test:app",
    "test:worker": "vitest run --config vitest.worker.config.ts",
    "test:app": "vitest run --config vitest.app.config.ts",
    "build": "tsc -b && vite build",
    "preview": "npm run build && vite preview",
    "deploy": "npm run build && wrangler deploy",
    "cf-typegen": "wrangler types"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [ ] **Step 2: Install the approved dependencies and generate the lockfile**

```bash
npm install hono react react-dom
npm install -D @cloudflare/vite-plugin @cloudflare/vitest-pool-workers @cloudflare/workers-types @testing-library/jest-dom @testing-library/react @types/react @types/react-dom @vitejs/plugin-react jsdom typescript vite vitest@^4.1.0 wrangler
```

Expected: `package-lock.json` is created and `package.json` contains only `hono`, `react`, and `react-dom` under `dependencies`.

- [ ] **Step 3: Add TypeScript and Vite configuration**

`tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.worker.json" }
  ]
}
```

`tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

`tsconfig.worker.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.worker.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2022", "WebWorker"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["worker"]
}
```

`vite.config.ts`:

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare()],
});
```

- [ ] **Step 4: Add the split Vitest configuration**

`vitest.worker.config.ts`:

```ts
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.worker.test.ts"],
  },
});
```

`vitest.app.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["test/**/*.app.test.tsx"],
    setupFiles: ["./test/setup.ts"],
  },
});
```

`test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
```

`test/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "types": [
      "vitest/globals",
      "@cloudflare/vitest-pool-workers/types",
      "@testing-library/jest-dom"
    ]
  },
  "include": ["./**/*.ts", "./**/*.tsx", "../worker", "../src"]
}
```

- [ ] **Step 5: Add the Cloudflare configuration**

`wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "cronup",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-08-20",
  "d1_databases": [{ "binding": "DB" }],
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/", "/api/*", "/ping/*"]
  },
  "triggers": {
    "crons": ["* * * * *"]
  }
}
```

The D1 entry intentionally omits resource IDs so Wrangler's draft-binding automatic provisioning can create the database. The Vite plugin intentionally supplies the built asset directory.

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CronUp</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:

```gitignore
node_modules/
dist/
.wrangler/
.dev.vars*
coverage/
*.tsbuildinfo
```

- [ ] **Step 6: Verify the configuration files are internally valid**

Run: `npm exec tsc -- --showConfig -p tsconfig.app.json`

Expected: TypeScript prints the resolved application configuration without a parse error.

The Wrangler dry-run is deferred until Task 3 because it must resolve the Worker entrypoint created in Task 2.

### Task 2: Drive the Worker and React shells from failing tests

**Files:**
- Create: `test/scaffold.worker.test.ts`, `test/scaffold.app.test.tsx`
- Create: `worker/env.ts`, `worker/index.ts`
- Create: `src/main.tsx`, `src/App.tsx`, `src/styles.css`

- [ ] **Step 1: Write the Worker smoke test before creating the Worker**

`test/scaffold.worker.test.ts`:

```ts
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("CronUp Worker scaffold", () => {
  it("returns the health response", async () => {
    const response = await exports.default.fetch(
      "https://cronup.test/api/health",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("exports a scheduled handler", () => {
    expect(exports.default.scheduled).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Write the React smoke test before creating the application**

`test/scaffold.app.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("CronUp React scaffold", () => {
  it("renders the product shell", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "CronUp" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Monitoring that runs on your Cloudflare account.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run both suites and verify RED**

Run: `npm test`

Expected: FAIL because `worker/index.ts` and `src/App.tsx` do not exist.

- [ ] **Step 4: Implement the minimal Worker**

`worker/env.ts`:

```ts
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}
```

`worker/index.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (context) => context.json({ status: "ok" }));
app.get("/", (context) => context.env.ASSETS.fetch(context.req.raw));

export default {
  fetch: app.fetch,
  scheduled() {},
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Implement the minimal React shell**

`src/App.tsx`:

```tsx
export default function App() {
  return (
    <main className="shell">
      <p className="eyebrow">Bring your own Cloudflare</p>
      <h1>CronUp</h1>
      <p>Monitoring that runs on your Cloudflare account.</p>
    </main>
  );
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("CronUp root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/styles.css`:

```css
:root {
  color: #172033;
  background: #f5f7fb;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

body {
  margin: 0;
}

.shell {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 4rem;
}

.eyebrow {
  color: #52617a;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

- [ ] **Step 6: Run the focused suites and verify GREEN**

Run: `npm run test:worker -- test/scaffold.worker.test.ts`

Expected: 2 Worker tests PASS in workerd.

Run: `npm run test:app -- test/scaffold.app.test.tsx`

Expected: 1 React test PASS in jsdom.

### Task 3: Verify reproducibility and commit AI-01

**Files:**
- Modify only if validation exposes a defect: files created in Tasks 1 and 2

- [ ] **Step 1: Verify the runtime dependency boundary**

Run: `node -e 'const p=require("./package.json"); const actual=Object.keys(p.dependencies).sort(); const expected=["hono","react","react-dom"]; if(JSON.stringify(actual)!==JSON.stringify(expected)) { console.error({actual,expected}); process.exit(1) }'`

Expected: exit code 0 with no output.

- [ ] **Step 2: Run all automated tests**

Run: `npm test`

Expected: Worker and application suites both PASS.

Run: `npm exec wrangler -- deploy --dry-run --outdir /tmp/cronup-ai01-dry-run`

Expected: Wrangler resolves the Worker, D1 draft binding, asset configuration, and Cron Trigger without deploying or requiring a Cloudflare login.

- [ ] **Step 3: Build the Worker and browser assets**

Run: `npm run build`

Expected: TypeScript and Vite complete successfully, and `dist/` contains the Worker bundle, generated Wrangler deployment configuration, `index.html`, and browser assets.

- [ ] **Step 4: Validate fresh-checkout installation semantics**

Run: `npm ci`

Expected: npm installs exactly from `package-lock.json` without changing `package.json` or `package-lock.json`.

Run: `git diff --exit-code -- package.json package-lock.json`

Expected: exit code 0.

- [ ] **Step 5: Re-run completion checks after clean installation**

Run: `npm test && npm run build`

Expected: all tests and both build targets PASS after `npm ci`.

- [ ] **Step 6: Commit only AI-01 files**

```bash
git add .gitignore package.json package-lock.json index.html tsconfig.json tsconfig.app.json tsconfig.worker.json vite.config.ts vitest.worker.config.ts vitest.app.config.ts wrangler.jsonc migrations/.gitkeep worker/env.ts worker/index.ts src/main.tsx src/App.tsx src/styles.css test/tsconfig.json test/setup.ts test/scaffold.worker.test.ts test/scaffold.app.test.tsx
git commit -m "chore: scaffold Cloudflare Worker and React app"
```
