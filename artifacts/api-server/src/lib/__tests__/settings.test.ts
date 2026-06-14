import { describe, expect, it } from "vitest";
import { resolveSettings } from "../settings";

describe("resolveSettings", () => {
  it("uses the registered organization name when business_name has not been saved", () => {
    expect(resolveSettings([], "My Activity").businessName).toBe("My Activity");
  });

  it("uses the saved business_name when an admin changes it in settings", () => {
    expect(
      resolveSettings([{ key: "business_name", value: "Updated Activity" }], "My Activity")
        .businessName,
    ).toBe("Updated Activity");
  });
});
