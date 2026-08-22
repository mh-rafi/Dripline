import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("falls back to defaults when env vars are unset", () => {
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.databaseUrl).toContain("postgres://");
  });

  it("reads PORT from the environment", () => {
    process.env.PORT = "4321";
    const config = loadConfig();
    expect(config.port).toBe(4321);
    delete process.env.PORT;
  });
});
