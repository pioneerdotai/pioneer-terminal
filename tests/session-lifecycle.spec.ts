import { chooseTerminalAction } from "./terminal-controls";
import { appState, flushState, expect, test, type Page, type WebSocketRoute } from "./app-test";

async function open(page: Page) {
  const attachments: { session: string | null; bytes: number }[] = [];
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket("**/terminal", socket => {
    const index = sockets.length;
    sockets.push(socket);
    socket.onMessage(raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "attach") {
        attachments.push({ session: message.session, bytes: message.bytes });
        socket.send(JSON.stringify({
          type: "ready", session: (index + 1).toString(16).padStart(64, "0"),
          resumed: false, input: 0,
        }));
      }
    });
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Terminal 1", exact: true })).toBeFocused();
  await expect.poll(() => attachments.length).toBe(1);
  return { attachments, sockets };
}

test("reload starts one new shell with no output, layout, or session identity persisted", async ({ page }) => {
  const h = await open(page);
  h.sockets[0].send(Buffer.from("old session output\r\n\x1b[?1049hprivate alternate screen"));
  await expect(page.locator(".term-grid")).toContainText("private alternate screen");
  await chooseTerminalAction(page, "Split right");
  await expect(page.getByRole("textbox", { name: "Terminal 2", exact: true })).toBeFocused();
  await expect.poll(() => h.attachments.length).toBe(2);
  await chooseTerminalAction(page, "Zoom pane");
  await flushState(page);
  expect([...appState(page).values.keys()]).toEqual([]);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Terminal 1", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect.poll(() => h.attachments.length).toBe(3);
  expect(h.attachments[2]).toEqual({ session: null, bytes: 0 });
  await expect(page.locator(".term-grid")).not.toContainText("old session output");
  await expect(page.locator(".term-grid")).not.toContainText("private alternate screen");
  await expect(page.getByRole("button", { name: "Restore panes", exact: true })).toHaveCount(0);
});

test("a later view ignores legacy recovery data and starts a clean shell", async ({ page }) => {
  appState(page).values.set("wterm.local.recovery.v1:fixture-execution", "broken legacy record");
  await page.addInitScript(() => {
    if (!/^https?:$/.test(location.protocol)) return;
    localStorage.setItem("wterm.local.recovery.v1:old", "old output");
    sessionStorage.setItem("wterm.local.recovery.v1:old", "old attachment");
    localStorage.setItem("unrelated", "keep");
  });
  const h = await open(page);
  h.sockets[0].send(Buffer.from("previous view output"));
  await expect(page.locator(".term-grid")).toContainText("previous view output");
  expect(await page.evaluate(() => ({
    local: localStorage.getItem("wterm.local.recovery.v1:old"),
    session: sessionStorage.getItem("wterm.local.recovery.v1:old"),
    unrelated: localStorage.getItem("unrelated"),
  }))).toEqual({ local: null, session: null, unrelated: "keep" });
  await page.goto("about:blank");
  await page.goto("/");
  await expect.poll(() => h.attachments.length).toBe(2);
  expect(h.attachments[1]).toEqual({ session: null, bytes: 0 });
  await expect(page.locator(".term-grid")).not.toContainText("previous view output");
  await expect(page.locator(".terminal-app").getByRole("alert")).toHaveCount(0);
});
