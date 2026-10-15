/**
 * The smoke test: if this passes, the app opens, the agent answers, a message reaches the
 * model and its reply streams back into the chat and is still there after a reload.
 */

import { expect, test, type APIRequestContext } from "@playwright/test";
import { PORTS, TOKEN } from "./ports";

const AGENT = `http://127.0.0.1:${PORTS.agent}`;
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

let modelId = "";

async function agent<T>(request: APIRequestContext, method: "get" | "post" | "put", path: string, data?: unknown): Promise<T> {
  const res = await request[method](`${AGENT}${path}`, { headers: HEADERS, data });
  expect(res.ok(), `${method.toUpperCase()} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

test.beforeAll(async ({ request }) => {
  // Past the first-run welcome: this test is about the chat, not the tour.
  const settings = await agent<Record<string, unknown>>(request, "get", "/settings");
  await agent(request, "put", "/settings", { ...settings, onboarded: true });
  // The pretend model, added the way the Models page adds one (Rafiq checks it answers).
  // As an LM Studio model it needs no key, so nothing is written to the system keychain.
  const model = await agent<{ id: string }>(request, "post", "/models", {
    name: "Fake model",
    provider: "lm_studio",
    model_id: "fake-echo",
    base_url: `http://127.0.0.1:${PORTS.model}/v1`,
  });
  modelId = model.id;
});

test("the app opens on the home page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("link", { name: "الإعدادات" })).toBeVisible();
  // The home page's own box for starting a chat, with nothing to start yet.
  await expect(page.getByRole("textbox", { name: "ابدأ محادثة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ابدأ" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("a message reaches the model and its reply comes back", async ({ page, request }) => {
  const chat = await agent<{ id: string }>(request, "post", "/chats", { model_id: modelId });
  await page.addInitScript((id) => localStorage.setItem("rafiq-chat-model", id), modelId);
  await page.goto(`/#/chat/${chat.id}`);

  const box = page.locator("textarea").first();
  await expect(box).toBeVisible();
  await box.fill("مرحبا يا رفيق");
  await box.press("Enter");

  // The question shows at once; the answer streams in from the model.
  await expect(page.getByText("مرحبا يا رفيق").first()).toBeVisible();
  await expect(page.getByText("وصلتني: مرحبا يا رفيق")).toBeVisible();

  // It was saved, not just drawn: the agent has it, and a reload shows it again.
  const roles = async () => (await agent<{ messages: { role: string }[] }>(request, "get", `/chats/${chat.id}`)).messages.map((m) => m.role);
  await expect.poll(roles).toEqual(["user", "assistant"]);
  await page.reload();
  await expect(page.getByText("وصلتني: مرحبا يا رفيق")).toBeVisible();
});
