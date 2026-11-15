import { appState, flushState } from "./app-test";
import { expect, test, type Page, type WebSocketRoute } from "./app-test";
import { acceptTerminal } from "./terminal-route";
import { APPEARANCE_KEY } from "../lib/appearance";

async function open(page: Page, path: string) {
  const sockets: WebSocketRoute[] = [];
  const input: string[] = [];
  const sizes: { cols: number; rows: number }[][] = [];
  await page.routeWebSocket("**/terminal", (socket) => {
    acceptTerminal(socket);
    const index = sockets.length;
    sockets.push(socket);
    sizes.push([]);
    socket.onMessage((data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "resize") sizes[index].push(message);
      if (message.type === "input") input.push(message.data);
    });
  });
  await page.goto(path);
  await expect(
    page.getByRole("textbox", { name: "Terminal 1", exact: true }),
  ).toBeFocused();
  await expect.poll(() => sizes[0]?.length ?? 0).toBeGreaterThan(0);
  return { sockets, input, sizes };
}
const appearanceDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Appearance", exact: true });
async function settings(page: Page) {
  await page
    .getByRole("button", { name: "Terminal actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  return appearanceDialog(page);
}

test(`appearance updates existing and new panes, resizes the PTY, and survives reload`, async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const h = await open(page, "/");
  h.sockets[0].send(Buffer.from("kept output\r\n\x1b[31mred text\x1b[0m"));
  await expect(page.locator(".term-grid")).toContainText("kept output");
  await page
    .locator(".term-grid")
    .evaluate((element) => Object.assign(window, { originalGrid: element }));
  const original = h.sizes[0].at(-1)!;
  const dialog = await settings(page);
  await expect(dialog.getByRole("combobox", { name: "Theme" })).toBeFocused();
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await dialog.getByRole("slider", { name: /Font size/ }).fill("20");
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(250, 250, 250)",
  );
  await expect(page.locator(".local-terminal")).toHaveCSS("font-size", "20px");
  await expect.poll(() => h.sizes[0].at(-1)!.cols).toBeLessThan(original.cols);
  await expect.poll(() => h.sizes[0].at(-1)!.rows).toBeLessThan(original.rows);
  await expect(page.locator(".term-grid")).toContainText("kept output");
  expect(
    await page
      .locator(".term-grid")
      .evaluate(
        (element) =>
          (window as unknown as { originalGrid: Element }).originalGrid ===
          element,
      ),
  ).toBe(true);
  expect(h.sockets).toHaveLength(1);
  expect(h.input).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Terminal actions", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Split right", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Terminal 2", exact: true }),
  ).toBeFocused();
  for (const terminal of await page.locator(".local-terminal").all()) {
    await expect(terminal).toHaveCSS("background-color", "rgb(250, 250, 250)");
    await expect(terminal).toHaveCSS("font-size", "20px");
  }
  await flushState(page);
  const stored = JSON.parse(appState(page).values.get(APPEARANCE_KEY)!);
  expect(stored).toEqual({ theme: "light", fontSize: 20 });
  // Wait for attachment, not just focus, before testing session recovery.
  await expect.poll(() => h.sizes[1]?.length ?? 0).toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Terminal 2", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".local-terminal")).toHaveCount(2);
  for (const terminal of await page.locator(".local-terminal").all()) {
    await expect(terminal).toHaveCSS("font-size", "20px");
    await expect(terminal).toHaveCSS("background-color", "rgb(250, 250, 250)");
  }
  await settings(page);
  await appearanceDialog(page)
    .getByRole("button", { name: "Reset defaults" })
    .click();
  for (const terminal of await page.locator(".local-terminal").all()) {
    await expect(terminal).toHaveCSS("font-size", "14px");
    await expect(terminal).toHaveCSS("background-color", "rgb(0, 0, 0)");
  }
});

test("system appearance follows OS changes while explicit choices stay fixed", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const h = await open(page, "/");
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(250, 250, 250)",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  const dialog = await settings(page);
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".workspace")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(h.sockets).toHaveLength(1);
  expect(h.input).toEqual([]);
});

test("theme updates repaint retained indexed colors and preserve fragmented input and application overrides", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const h = await open(page, "/");
  h.sockets[0].send(
    Buffer.from(
      Array.from({ length: 200 }, (_, i) => `\x1b[31mretained ${i}\r\n`).join(
        "",
      ),
    ),
  );
  await expect(
    page.locator(".term-row").filter({ hasText: "retained 199" }),
  ).toHaveCount(1);
  await page.locator(".local-terminal").evaluate((element) => {
    element.scrollTop = 0;
  });
  const first = page.locator(".term-scrollback-row").first();
  await expect(first).toBeVisible();
  await expect(first).toContainText("retained");
  await settings(page);
  await appearanceDialog(page)
    .getByRole("combobox", { name: "Theme" })
    .selectOption("light");
  await expect(first.locator("span").first()).toHaveCSS(
    "color",
    "rgb(228, 86, 73)",
  );
  h.sockets[0].send(
    Buffer.from("\x1b]11;#123456\x07\x1b]10;#abcdef\x07\x1b[?1049h\x1b[3"),
  );
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  await appearanceDialog(page)
    .getByRole("combobox", { name: "Theme" })
    .selectOption("dark");
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  h.sockets[0].send(
    Buffer.from("2mfragment survived\x1b]110\x07\x1b]111\x07\x1b]11;?\x07"),
  );
  await expect(
    page.locator(".term-row").filter({ hasText: "fragment survived" }),
  ).toHaveCount(1);
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)",
  );
  await expect
    .poll(() => h.input.join(""))
    .toBe("\x1b]11;rgb:0000/0000/0000\x07");
  expect(h.sockets).toHaveLength(1);
});

test("corrupt settings and backend persistence failure leave appearance usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  appState(page).values.set(APPEARANCE_KEY, '{"theme":"invalid","fontSize":99999}');
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, "/");
  await expect(page.locator(".local-terminal")).toHaveCSS("font-size", "14px");
  appState(page).failWrites = true;
  const dialog = await settings(page);
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await expect(page.getByRole("alert").filter({ hasText: "could not be saved" })).toContainText("could not be saved");
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(250, 250, 250)",
  );
  expect(errors).toEqual([]);
});

test("saved appearance is restored by a later view without browser storage", async ({ page }) => {
  await open(page, "/");
  const dialog = await settings(page);
  await dialog.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await dialog.getByRole("slider", { name: /Font size/ }).fill("18");
  await flushState(page);
  await page.addInitScript(() => {
    for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(window, key, { get() { throw new DOMException("Opaque origin", "SecurityError"); } });
  });
  await page.reload();
  await expect(page.locator(".local-terminal")).toHaveCSS("font-size", "18px");
  await expect(page.locator(".local-terminal")).toHaveCSS("background-color", "rgb(250, 250, 250)");
});
