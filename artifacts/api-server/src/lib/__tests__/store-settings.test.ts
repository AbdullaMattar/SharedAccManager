import { describe, expect, it } from "vitest";
import { resolvePlatformWebsiteEnabled } from "../store-settings";

describe("resolvePlatformWebsiteEnabled", () => {
  it("always keeps the demo organization enabled even if a stale setting says false", () => {
    expect(resolvePlatformWebsiteEnabled(1, "false")).toBe(true);
  });

  it("uses the saved platform setting for regular organizations", () => {
    expect(resolvePlatformWebsiteEnabled(2, "false")).toBe(false);
    expect(resolvePlatformWebsiteEnabled(2, "true")).toBe(true);
  });
});
