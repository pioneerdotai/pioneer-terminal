import { chooseTerminalAction } from "./terminal-controls";
import { appState, flushState } from "./app-test";
import { expect, test, type Page, type WebSocketRoute } from "./app-test";
import { makeHostTheme } from "./host-theme";
import { acceptTerminal } from "./terminal-route";
import { APPEARANCE_KEY } from "../features/terminal/settings/appearance";

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

const lightTheme = makeHostTheme("light", {
  background: "#eeeeee", foreground: "#111111", tab_bar: "#f2f3f4", popover: "#e8eef4",
  muted_foreground: "#777777", border: "#aaaaaa", primary: "#3366ff", primary_foreground: "#ffffff",
  ring: "#aabbcc", caret: "#2299dd", red: "#e45649", blue_light: "#99bbff",
  success: "#22aa66", warning: "#dd8800", danger: "#dd3344", info: "#3399dd",
});
const statusIndicator = (page: Page) => page.getByRole("navigation", { name: "Terminal sessions" })
  .getByRole("button", { pressed: true }).locator('span[aria-hidden="true"]');
async function hostTheme(page: Page, theme = lightTheme) {
  await page.evaluate(json => {
    window.postMessage({ type: "pioneer.theme", theme: JSON.parse(json) }, location.origin);
  }, JSON.stringify(theme));
  await expect(page.locator(".workspace")).toHaveAttribute("data-theme", theme.mode);
}

for (const surface of [
  { mode: "light", os: "dark", background: "#fdfaf1", foreground: "#111111", tabBar: "#fcfcf7", rgb: "rgb(253, 250, 241)", tabRgb: "rgb(252, 252, 247)" },
  { mode: "dark", os: "light", background: "#080b10", foreground: "#eeeeee", tabBar: "#10100d", rgb: "rgb(8, 11, 16)", tabRgb: "rgb(16, 16, 13)" },
] as const) {
  test(`${surface.mode} host surface survives SSR, theme delivery and terminal startup`, async ({ page }) => {
    // Opposite OS appearance and custom colors expose both Canvas and fallback
    // palette leaks. The host's CSS boot contract precedes application scripts.
    await page.emulateMedia({ colorScheme: surface.os });
    await page.addInitScript(({ mode, background, foreground }) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(":root {}");
      const style = (sheet.cssRules[0] as CSSStyleRule).style;
      style.setProperty("--pioneer-color-scheme", mode);
      style.setProperty("--pioneer-background", background);
      style.setProperty("--pioneer-foreground", foreground);
      style.setProperty("--pioneer-host-theme", "1");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }, surface);
    const hydrationErrors: string[] = [];
    page.on("console", message => {
      if (/hydration|hydrated/i.test(message.text())) hydrationErrors.push(message.text());
    });
    page.on("pageerror", error => hydrationErrors.push(error.message));
    await page.routeWebSocket("**/terminal", acceptTerminal);
    let releaseScripts!: () => void;
    let releaseEngine!: () => void;
    const scripts = new Promise<void>(resolve => { releaseScripts = resolve; });
    const engine = new Promise<void>(resolve => { releaseEngine = resolve; });
    await page.route(/\.js(?:\?|$)/, async route => {
      await scripts;
      await route.continue();
    });
    await page.route("**/ghostty-vt.wasm", async route => {
      await engine;
      await route.continue();
    });
    const preferences = page.waitForRequest(request =>
      request.method() === "GET" && new URL(request.url()).pathname.endsWith("/state"));
    try {
      await page.goto("/", { waitUntil: "commit" });
      const app = page.locator(".terminal-app");
      await expect(app).toBeVisible();
      await expect(page.locator("body")).toHaveCSS("background-color", surface.rgb);
      await expect(app).toHaveCSS("background-color", surface.rgb);
      await expect(page.getByRole("navigation", { name: "Terminal sessions" })).toHaveCount(0);
      releaseScripts();
      await preferences; // Hydration is running, but no host snapshot is available.
      await expect(app).toHaveCSS("background-color", surface.rgb);
      await expect(page.getByRole("navigation", { name: "Terminal sessions" })).toHaveCount(0);
      const theme = makeHostTheme(surface.mode, {
        background: surface.background, foreground: surface.foreground, tab_bar: surface.tabBar,
      });
      await hostTheme(page, theme);
      await expect(page.locator(".workspace > header")).toHaveCSS("background-color", surface.tabRgb);
      await expect(page.getByRole("button", { name: "Starting…", exact: true }).first()
        .locator("..")).toHaveCSS("background-color", surface.rgb);
      await expect(page.locator("main")).toHaveCSS("background-color", surface.rgb);
      await expect(page.locator(".local-terminal")).toHaveCount(0);
      releaseEngine();
      await expect(page.getByRole("textbox", { name: "Terminal 1", exact: true })).toBeFocused();
      await expect(page.locator(".local-terminal")).toHaveCSS("background-color", surface.rgb);
      await expect(app).toHaveCSS("background-color", surface.rgb);
      expect(hydrationErrors).toEqual([]);
    } finally {
      releaseScripts();
      releaseEngine();
    }
  });
}

test("Pioneer palette owns the whole UI and parser, including updates within one appearance", async ({ page }) => {
  // A preference written by an older version cannot override the host palette.
  appState(page).values.set(APPEARANCE_KEY, '{"theme":"dark","fontSize":18}');
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (/hydration|hydrated/i.test(message.text())) hydrationErrors.push(message.text());
  });
  const h = await open(page, "/");
  h.sockets[0].send(Buffer.from("retained across host theme\r\n"));
  await expect(page.locator(".term-grid")).toContainText("retained across host theme");
  await page.locator(".term-grid").evaluate(element => Object.assign(window, { sdkThemeGrid: element }));
  await hostTheme(page);
  await expect(page.locator(".workspace")).toHaveCSS("background-color", "rgb(238, 238, 238)");
  await expect(page.locator(".local-terminal")).toHaveCSS("background-color", "rgb(238, 238, 238)");
  await expect(page.locator(".local-terminal")).toHaveCSS("color", "rgb(17, 17, 17)");
  await expect(statusIndicator(page)).toHaveCSS("background-color", "rgb(34, 170, 102)");
  await expect(page.locator(".workspace > header")).toHaveCSS("border-bottom-color", "rgb(170, 170, 170)");
  const dialog = await settings(page);
  await expect(dialog.getByRole("combobox", { name: "Theme" })).toHaveCount(0);
  await expect(dialog).toHaveCSS("background-color", "rgb(232, 238, 244)");
  await expect(page.locator(".workspace > header")).toHaveCSS("background-color", "rgb(242, 243, 244)");
  await expect(page.locator(".local-terminal")).toHaveCSS("font-family", /Fixture Mono/);
  await expect(dialog.locator("p").first()).toHaveCSS("color", "rgb(119, 119, 119)");

  // Change all the RGB values without changing light/dark mode.
  await hostTheme(page, {
    ...lightTheme,
    colors: {
      ...lightTheme.colors, background: "rgba(221,238,255,1)", foreground: "#223344",
      popover: "#d3dde7", tab_bar: "#d9e3ed", muted_foreground: "#556677",
      border: "#667788", primary: "#445566", caret: "#557799", success: "#42a386",
    },
  });
  await expect(dialog).toHaveCSS("background-color", "rgb(211, 221, 231)");
  await expect(page.locator(".workspace > header")).toHaveCSS("background-color", "rgb(217, 227, 237)");
  await expect(page.locator(".local-terminal")).toHaveCSS("background-color", "rgb(221, 238, 255)");
  await expect(page.locator(".local-terminal")).toHaveCSS("color", "rgb(34, 51, 68)");
  await expect(statusIndicator(page)).toHaveCSS("background-color", "rgb(66, 163, 134)");
  await expect(page.locator(".workspace > header")).toHaveCSS("border-bottom-color", "rgb(102, 119, 136)");
  await page.keyboard.press("Escape");
  // This Ghostty version answers OSC 10/11; verify the cursor's visible
  // color directly rather than expecting an unsupported OSC 12 reply.
  await expect(page.locator(".term-cursor")).toHaveCSS("outline-color", "rgb(85, 119, 153)");
  h.sockets[0].send(Buffer.from("\x1b]10;?\x07\x1b]11;?\x07"));
  await expect.poll(() => h.input.join("")).toBe(
    "\x1b]10;rgb:2222/3333/4444\x07\x1b]11;rgb:dddd/eeee/ffff\x07",
  );
  await expect(page.locator(".term-grid")).toContainText("retained across host theme");
  expect(await page.locator(".term-grid").evaluate(element =>
    (window as unknown as { sdkThemeGrid: Element }).sdkThemeGrid === element)).toBe(true);
  expect(h.sockets).toHaveLength(1);
  expect(hydrationErrors).toEqual([]);
});

test("tab status uses host warning while connecting, success when ready, and muted after closure", async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  const attachments: Promise<void>[] = [];
  await page.routeWebSocket("**/terminal", socket => {
    sockets.push(socket);
    attachments.push(new Promise(resolve => {
      socket.onMessage(raw => {
        if (JSON.parse(raw.toString()).type === "attach") resolve();
      });
    }));
  });
  await page.goto("/");
  await expect.poll(() => sockets.length).toBe(1);
  await attachments[0];
  await hostTheme(page);
  await expect(statusIndicator(page)).toHaveCSS("background-color", "rgb(221, 136, 0)");
  sockets[0].send(JSON.stringify({ type: "ready", session: "a".repeat(64), resumed: false, input: 0 }));
  await expect(statusIndicator(page)).toHaveCSS("background-color", "rgb(34, 170, 102)");
  sockets[0].close({ code: 1000, reason: "Session ended" });
  await expect(statusIndicator(page)).toHaveCSS("background-color", "rgb(119, 119, 119)");
});

test(`font size updates existing and new panes, resizes the PTY, and survives reload`, async ({
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
  await expect(dialog.getByRole("slider", { name: /Font size/ })).toBeFocused();
  await dialog.getByRole("slider", { name: /Font size/ }).fill("20");
  await expect(page.locator(".local-terminal")).toHaveCSS(
    "background-color",
    "rgb(10, 10, 10)",
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
  await chooseTerminalAction(page, "Split right");
  await expect(
    page.getByRole("textbox", { name: "Terminal 2", exact: true }),
  ).toBeFocused();
  for (const terminal of await page.locator(".local-terminal").all()) {
    await expect(terminal).toHaveCSS("background-color", "rgb(10, 10, 10)");
    await expect(terminal).toHaveCSS("font-size", "20px");
  }
  await flushState(page);
  const stored = JSON.parse(appState(page).values.get(APPEARANCE_KEY)!);
  expect(stored).toEqual({ fontSize: 20 });
  // Both old connections must exist before reloading into a fresh workspace.
  await expect.poll(() => h.sizes[1]?.length ?? 0).toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Terminal 1", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".local-terminal")).toHaveCount(1);
  for (const terminal of await page.locator(".local-terminal").all()) {
    await expect(terminal).toHaveCSS("font-size", "20px");
    await expect(terminal).toHaveCSS("background-color", "rgb(10, 10, 10)");
  }
  await settings(page);
  await appearanceDialog(page)
    .getByRole("button", { name: "Reset defaults" })
    .click();
  for (const terminal of await page.locator(".local-terminal").all()) {
    await expect(terminal).toHaveCSS("font-size", "13px");
    await expect(terminal).toHaveCSS("background-color", "rgb(10, 10, 10)");
  }
});

test("standalone fallback follows the OS until a Pioneer palette is supplied", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const h = await open(page, "/");
  await expect(page.locator(".local-terminal")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".local-terminal")).toHaveCSS("background-color", "rgb(10, 10, 10)");
  await hostTheme(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".workspace")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".local-terminal")).toHaveCSS("background-color", "rgb(238, 238, 238)");
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
  await hostTheme(page);
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
  await hostTheme(page, { ...lightTheme, mode: "dark", colors: { ...lightTheme.colors, background: "#112233" } });
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
    "rgb(17, 34, 51)",
  );
  await expect
    .poll(() => h.input.join(""))
    .toBe("\x1b]11;rgb:1111/2222/3333\x07");
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
  await expect(page.locator(".local-terminal")).toHaveCSS("font-size", "13px");
  appState(page).failWrites = true;
  const dialog = await settings(page);
  await dialog.getByRole("slider", { name: /Font size/ }).fill("20");
  await expect(page.getByRole("alert").filter({ hasText: "could not be saved" })).toContainText("could not be saved");
  await expect(page.locator(".local-terminal")).toHaveCSS("font-size", "20px");
  expect(errors).toEqual([]);
});

test("saved appearance is restored by a later view without browser storage", async ({ page }) => {
  await open(page, "/");
  const dialog = await settings(page);
  await dialog.getByRole("slider", { name: /Font size/ }).fill("18");
  await flushState(page);
  await page.addInitScript(() => {
    for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(window, key, { get() { throw new DOMException("Opaque origin", "SecurityError"); } });
  });
  await page.reload();
  await expect(page.locator(".local-terminal")).toHaveCSS("font-size", "18px");
});
