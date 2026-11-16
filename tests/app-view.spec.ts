import { chooseTerminalAction } from "./terminal-controls";
import { expect, test, type Page } from "./app-test";
import { acceptTerminal, terminalReady } from "./terminal-route";

type ViewRequest = { type: string; placement?: string };
type ViewWindow = Window & { viewRequests: ViewRequest[] };

async function open(page: Page) {
  const sockets: Parameters<typeof acceptTerminal>[0][] = [];
  const shellCommands: string[] = [];
  await page.routeWebSocket("**/terminal", socket => {
    sockets.push(socket);
    acceptTerminal(socket);
    socket.onMessage(raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "input" || message.type === "close")
        shellCommands.push(message.type);
    });
  });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Terminal 1", exact: true })).toBeFocused();
  await expect.poll(() => sockets.length).toBe(1);
  await terminalReady(sockets[0]);
  await page.evaluate(() => {
    const target = window as unknown as ViewWindow;
    target.viewRequests = [];
    // Host-side protocol fixture: the application and SDK still handle the
    // actual button action, request creation and acknowledgement delivery.
    window.addEventListener("message", event => {
      if (event.source !== window || event.origin !== location.origin) return;
      const request = event.data;
      if (request?.type !== "pioneer.view.setPlacement" && request?.type !== "pioneer.view.close") return;
      target.viewRequests.push({ type: request.type, ...(request.placement ? { placement: request.placement } : {}) });
      if (request.type === "pioneer.view.setPlacement") {
        window.postMessage({ type: "pioneer.view.result", id: request.id, placement: request.placement }, location.origin);
      }
    });
  });
  return { sockets, shellCommands };
}

const requests = (page: Page) => page.evaluate(() => (window as unknown as ViewWindow).viewRequests);

test("placement preserves mounted sessions and App close terminates them before requesting view closure", async ({ page }) => {
  const h = await open(page);
  h.sockets[0].send(Buffer.from("retained app output\r\n"));
  await expect(page.locator(".term-grid")).toContainText("retained app output");
  await page.locator(".term-grid").evaluate(element => Object.assign(window, { retainedAppGrid: element }));

  // Only these four controls belong in the toolbar, in this order.
  const toolbar = page.locator("header");
  // Session tabs have their own buttons; inspect the toolbar beside that navigation.
  const controls = toolbar.locator(":scope > div").last();
  await expect(controls.getByRole("button")).toHaveCount(4);
  for (const [index, name] of ["New terminal session", "Find", "Terminal actions", "Close app"].entries())
    await expect(controls.getByRole("button").nth(index)).toHaveAccessibleName(name);
  await page.getByRole("button", { name: "Terminal actions", exact: true }).click();
  const placementGroup = page.getByRole("group", { name: "App placement", exact: true });
  await expect(placementGroup.getByRole("button", { pressed: true })).toHaveAccessibleName("Expand app");
  // Placement, split commands, then remaining actions, with exactly two dividers.
  const menu = page.locator('[popover]:popover-open');
  await expect(menu.getByRole("separator")).toHaveCount(2);
  expect((await menu.getByRole("button").allTextContents()).slice(0, 5)).toEqual([
    "Move app to bottom", "Move app to right", "Expand app", "Split right", "Split down",
  ]);
  const firstDivider = (await menu.getByRole("separator").nth(0).boundingBox())!;
  const secondDivider = (await menu.getByRole("separator").nth(1).boundingBox())!;
  const placements = (await placementGroup.boundingBox())!;
  const splits = (await page.getByRole("group", { name: "Split panes", exact: true }).boundingBox())!;
  expect(placements.y + placements.height).toBeLessThanOrEqual(firstDivider.y);
  expect(splits.y).toBeGreaterThan(firstDivider.y);
  expect(splits.y + splits.height).toBeLessThanOrEqual(secondDivider.y);
  for (const name of ["Appearance", "Keyboard shortcuts", "Read output"]) {
    const action = (await menu.getByRole("button", { name, exact: true }).boundingBox())!;
    expect(action.y).toBeGreaterThan(secondDivider.y);
  }
  await page.keyboard.press("Escape");

  const expected: ViewRequest[] = [];
  for (const [label, placement] of [
    ["Move app to bottom", "bottom"],
    ["Move app to right", "right"],
    ["Expand app", "fullscreen"],
  ]) {
    await page.getByRole("button", { name: "Terminal actions", exact: true }).click();
    const button = page.getByRole("button", { name: label, exact: true });
    await expect(button).toHaveAttribute("title", label);
    await button.focus();
    await page.keyboard.press("Enter");
    expected.push({ type: "pioneer.view.setPlacement", placement });
    await expect.poll(() => requests(page)).toEqual(expected);
    await expect(menu).toHaveCount(0);
    await page.getByRole("button", { name: "Terminal actions", exact: true }).click();
    await expect(placementGroup.getByRole("button", { pressed: true })).toHaveAccessibleName(label);
    await expect(button).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(page.locator(".term-grid")).toContainText("retained app output");
  }
  expect(await page.locator(".term-grid").evaluate(element =>
    (window as unknown as { retainedAppGrid: Element }).retainedAppGrid === element)).toBe(true);

  expect(h.shellCommands).toEqual([]);
  await page.getByRole("button", { name: "Close app", exact: true }).click();
  expected.push({ type: "pioneer.view.close" });
  await expect.poll(() => requests(page)).toEqual(expected);
  expect(h.sockets).toHaveLength(1);
  await expect.poll(() => h.shellCommands).toEqual(["close"]);
});

test("failed placement is reported inline and the control can be retried", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const send = window.postMessage.bind(window);
    let fail = true;
    window.postMessage = ((message: { type?: string }, origin: string) => {
      if (fail && message?.type === "pioneer.view.setPlacement") {
        fail = false;
        throw new Error("Native transport unavailable");
      }
      send(message, origin);
    }) as typeof window.postMessage;
  });
  await chooseTerminalAction(page, "Move app to right");
  const button = page.getByRole("button", { name: "Move app to right", exact: true });
  await expect(page.locator(".terminal-app").getByRole("alert")).toHaveText("Could not move this app. Try again.");
  await expect(button).toBeEnabled();
  await expect(page.getByRole("group", { name: "App placement", exact: true }).getByRole("button", { pressed: true })).toHaveAccessibleName("Expand app");
  await button.click();
  await expect.poll(() => requests(page)).toEqual([{ type: "pioneer.view.setPlacement", placement: "right" }]);
  await expect(page.locator(".terminal-app").getByRole("alert")).toHaveCount(0);
  await expect(page.locator('[popover]:popover-open')).toHaveCount(0);
  await page.getByRole("button", { name: "Terminal actions", exact: true }).click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toBeEnabled();
});
