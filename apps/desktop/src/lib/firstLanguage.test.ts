import { beforeEach, describe, expect, it, vi } from "vitest";

const installer = { language: null as string | null };
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string) => (command === "installer_language" ? installer.language : null),
}));

const { adoptInstallerLanguage } = await import("./firstLanguage");

describe("the first launch's language", () => {
  beforeEach(() => localStorage.clear());

  it("is the one picked in the installer", async () => {
    installer.language = "ru";
    await adoptInstallerLanguage();
    expect(localStorage.getItem("rafiq-locale")).toBe("ru");
  });

  it("never replaces a language chosen in the app", async () => {
    localStorage.setItem("rafiq-locale", "en");
    installer.language = "ar";
    await adoptInstallerLanguage();
    expect(localStorage.getItem("rafiq-locale")).toBe("en");
  });

  it("stays the default when the installer left nothing", async () => {
    installer.language = null;
    await adoptInstallerLanguage();
    expect(localStorage.getItem("rafiq-locale")).toBeNull();
  });
});
