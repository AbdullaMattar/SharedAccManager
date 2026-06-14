import { describe, it, expect } from "vitest";
import XlsxPopulate from "xlsx-populate";

describe("xlsx-populate encryption round-trip", () => {
  const passphrase = "correct horse";

  it("encrypts and re-reads with the right passphrase", async () => {
    const wb = await XlsxPopulate.fromBlankAsync();
    wb.sheet(0).name("test").cell("A1").value("hello");
    const buffer = (await wb.outputAsync({ password: passphrase })) as Buffer;
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);

    const reopened = await XlsxPopulate.fromDataAsync(buffer, { password: passphrase });
    expect(reopened.sheet("test").cell("A1").value()).toBe("hello");
  });

  it("rejects the wrong passphrase", async () => {
    const wb = await XlsxPopulate.fromBlankAsync();
    wb.sheet(0).cell("A1").value("secret");
    const buffer = (await wb.outputAsync({ password: passphrase })) as Buffer;
    await expect(XlsxPopulate.fromDataAsync(buffer, { password: "wrong" })).rejects.toBeTruthy();
  });
});
