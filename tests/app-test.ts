import { test as base, type BrowserContext, type Page } from "@playwright/test";
export { expect, type Page, type WebSocketRoute } from "@playwright/test";

interface StateFixture {
  values: Map<string, string>;
  failWrites: boolean;
}
const states = new WeakMap<BrowserContext, StateFixture>();
export function appState(page: Page): StateFixture { return states.get(page.context())!; }
export async function flushState(page: Page) {
  await page.evaluate(async () => {
    // The test observes real fetch completion, without an application test hook.
    for (let pass = 0; pass < 2; pass++) {
      document.dispatchEvent(new Event("visibilitychange"));
      await (window as unknown as { terminalStateCommit?: Promise<unknown> }).terminalStateCommit;
    }
  });
}
export const test = base.extend<{ appStateFixture: StateFixture }>({
  appStateFixture: [async ({ context }, use) => {
    const state: StateFixture = { values: new Map(), failWrites: false };
    states.set(context, state);
    await context.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = (...args) => {
        const response = original(...args);
        if (args[1]?.method === "POST" && new URL(String(args[0]), document.baseURI).pathname.endsWith("/state")) {
          (window as unknown as { terminalStateCommit: Promise<unknown> }).terminalStateCommit = response.then((r) => r.clone().text()).catch(() => {});
        }
        return response;
      };
    });
    await context.route("**/state", async (route) => {
      if (route.request().method() === "POST") {
        if (state.failWrites) { await route.fulfill({ status: 503, body: "{}" }); return; }
        const { changes } = route.request().postDataJSON();
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) state.values.delete(key);
          else state.values.set(key, value as string);
        }
        await route.fulfill({ json: {} });
      } else await route.fulfill({ json: { execution: "fixture-execution", values: Object.fromEntries(state.values) } });
    });
    await use(state);
    states.delete(context);
  }, { auto: true }],
  page: async ({ page, appStateFixture }, use) => {
    void appStateFixture;
    const reload = page.reload.bind(page);
    page.reload = async (...args) => { await flushState(page); return reload(...args); };
    await use(page);
  },
});
