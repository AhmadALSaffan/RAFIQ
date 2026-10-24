import { describe, expect, it } from "vitest";
import { errorText } from "./client";

describe("errorText", () => {
  it("keeps the agent's own message", () => {
    expect(errorText("The model didn't answer")).toBe("The model didn't answer");
  });

  it("reads a rejected request's list instead of printing [object Object]", () => {
    const detail = [{ loc: ["body", "provider"], msg: "Input should be 'anthropic' or 'openai'", type: "literal_error" }];
    expect(errorText(detail)).toBe("provider: Input should be 'anthropic' or 'openai'");
  });

  it("reads an object's message, and has nothing for nothing", () => {
    expect(errorText({ message: "Signed out" })).toBe("Signed out");
    expect(errorText(null)).toBeNull();
    expect(errorText([])).toBeNull();
  });
});
