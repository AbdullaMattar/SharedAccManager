import { describe, expect, it } from "vitest";
import {
  resolvePlatformWebsiteEnabled,
  resolveWebsiteConfig,
  productNameKey,
  productDescriptionKey,
  productImageKey,
  STORE_LOGO_KEY,
} from "../store-settings";

describe("resolvePlatformWebsiteEnabled", () => {
  it("always keeps the demo organization enabled even if a stale setting says false", () => {
    expect(resolvePlatformWebsiteEnabled(1, "false")).toBe(true);
  });

  it("uses the saved platform setting for regular organizations", () => {
    expect(resolvePlatformWebsiteEnabled(2, "false")).toBe(false);
    expect(resolvePlatformWebsiteEnabled(2, "true")).toBe(true);
  });
});

describe("product metadata key helpers", () => {
  it("generates namespaced settings keys for each product field", () => {
    expect(productNameKey(42)).toBe("store_product_42_name");
    expect(productDescriptionKey(42)).toBe("store_product_42_description");
    expect(productImageKey(42)).toBe("store_product_42_image");
  });

  it("uses the product id in the key so different products do not collide", () => {
    expect(productNameKey(1)).not.toBe(productNameKey(2));
    expect(productImageKey(5)).not.toBe(productImageKey(6));
  });
});

describe("resolveWebsiteConfig", () => {
  it("returns a public logo url when a store logo is configured", () => {
    const config = resolveWebsiteConfig([
      { key: "store_slug", value: "demo-store" },
      { key: STORE_LOGO_KEY, value: "1-logo.png" },
    ], "Demo");

    expect(config.logoUrl).toBe("/store-images/1-logo.png");
  });
});
