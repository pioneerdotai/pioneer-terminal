import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { acceptTerminal, terminalReady } from "./terminal-route";

const marker = (value: string) => `\x1b]133;${value}\x07`;
const history = (name: string) =>
  ["first", "second", "third"]
    .map(
      (label) =>
        marker("A;redraw=0") +
        `${name}-${label}> ` +
        marker("B") +
        "echo output" +
        marker("C") +
        "\r\n" +
        "ordinary output\r\n".repeat(80) +
        marker("D;0"),
    )
    .join("") +
  marker("A;redraw=0") +
  `${name}-current> ` +
  marker("B");
const input = (page: Page, number: number) =>
  page.getByRole("textbox", { name: `Terminal ${number}`, exact: true });
const pane = (page: Page, number: number) =>
  page.getByRole("tabpanel", { name: `Terminal ${number}`, exact: true });
async function topText(page: Page, number: number) {
  return pane(page, number)
    .locator(".local-terminal")
    .evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      return Array.from(element.querySelectorAll(".term-row")).find(
        (row) => row.getBoundingClientRect().bottom > top + 2,
      )?.textContent;
    });
}
async function open(page: Page, shellIntegration = true) {
  const sockets: WebSocketRoute[] = [],
    received: string[] = [];
  const acknowledgments: number[] = [];
  await page.addInitScript(() => {
    localStorage.setItem(
      "wterm.local.shortcuts.v1",
      JSON.stringify({
        previousPrompt: ["Control+Shift+ArrowUp"],
        nextPrompt: ["Control+Shift+ArrowDown"],
      }),
    );
  });
  await page.routeWebSocket("**/api/terminal", (socket) => {
    acceptTerminal(socket);
    const index = sockets.length;
    sockets.push(socket);
    acknowledgments.push(0);
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "input") received.push(message.data);
      if (message.type === "ack") acknowledgments[index] = message.bytes;
    });
  });
  await page.goto("/");
  const ready = async (number: number) => {
    await expect(input(page, number)).toBeFocused();
    await expect.poll(() => sockets.length).toBeGreaterThanOrEqual(number);
    await terminalReady(sockets[number - 1]);
    const output = history(`shell${number}`);
    sockets[number - 1].send(
      Buffer.from(
        shellIntegration
          ? output
          : output.replace(/\x1b\]133;[^\x07]*\x07/g, ""),
      ),
    );
    await expect(pane(page, number).locator(".term-grid")).toContainText(
      `shell${number}-current>`,
    );
  };
  await ready(1);
  return { sockets, received, ready, acknowledgments };
}

test("prompt controls and configured shortcuts navigate the focused session without sending navigation keys", async ({
  page,
}) => {
  const h = await open(page);
  const previous = page.getByRole("button", {
    name: "Previous prompt",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Terminal actions", exact: true })
    .click();
  await expect(previous).toBeVisible();
  await expect(previous).toHaveAttribute(
    "aria-keyshortcuts",
    "Control+Shift+ArrowUp",
  );
  await previous.click();
  await expect.poll(() => topText(page, 1)).toContain("shell1-third>");
  await previous.click();
  await expect.poll(() => topText(page, 1)).toContain("shell1-second>");
  await page.getByRole("button", { name: "Next prompt", exact: true }).click();
  await expect.poll(() => topText(page, 1)).toContain("shell1-third>");
  await page
    .getByRole("button", { name: "New terminal session", exact: true })
    .click();
  await h.ready(2);
  await page
    .getByRole("button", { name: "Terminal actions", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Previous prompt", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Terminal sessions" })
    .locator("button[aria-controls]")
    .nth(1)
    .click();
  const mode = Buffer.from("\x1b[>11u");
  h.sockets[1].send(mode);
  await expect
    .poll(() => h.acknowledgments[1])
    .toBe(Buffer.byteLength(history("shell2")) + mode.length);
  await page.keyboard.press("Control+Shift+ArrowUp");
  await expect.poll(() => topText(page, 2)).toContain("shell2-third>");
  await expect(input(page, 2)).toBeFocused();
  await page.keyboard.press("Control+Shift+ArrowDown");
  await expect
    .poll(() =>
      pane(page, 2)
        .locator(".local-terminal")
        .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(5);
  await page
    .getByRole("button", { name: "Starting…", exact: true })
    .first()
    .click();
  await expect(input(page, 1)).toBeFocused();
  await expect.poll(() => topText(page, 1)).toContain("shell1-third>");
  // Report-all applications still receive balanced physical modifier events;
  // the host-owned arrow keys must never reach the shell.
  await expect.poll(() => h.received.length).toBeGreaterThan(0);
  expect(
    h.received.every((data) => /^\x1b\[5744[12];[0-9]+(?::3)?u$/.test(data)),
  ).toBe(true);
});

test("shells without integration markers do not advertise prompt navigation", async ({
  page,
}) => {
  const h = await open(page, false);
  await expect(pane(page, 1).locator(".term-grid")).toContainText(
    "shell1-current>",
  );
  await page
    .getByRole("button", { name: "Terminal actions", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Prompt navigation" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Terminal sessions" })
    .locator("button[aria-controls]")
    .first()
    .click();
  const before = await pane(page, 1)
    .locator(".local-terminal")
    .evaluate((el) => el.scrollTop);
  await page.keyboard.press("Control+Shift+ArrowUp");
  expect(
    await pane(page, 1)
      .locator(".local-terminal")
      .evaluate((el) => el.scrollTop),
  ).toBe(before);
  expect(h.received).toEqual([]);
});
