import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  describe("in production", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
      process.env.APP_URL = "https://mail.example.com";
    });
    afterEach(() => {
      delete process.env.NODE_ENV;
      delete process.env.APP_URL;
      delete process.env.JWT_SECRET;
      delete process.env.TRACKING_SECRET;
    });

    it("refuses to start on the published development secrets", () => {
      process.env.JWT_SECRET = "dev-insecure-secret-change-me";
      process.env.TRACKING_SECRET = "real-tracking-secret";
      expect(() => loadConfig()).toThrow(/JWT_SECRET must be set/);
    });

    it("refuses to start with secrets unset", () => {
      expect(() => loadConfig()).toThrow(/JWT_SECRET must be set/);
    });

    it("accepts real secrets", () => {
      process.env.JWT_SECRET = "a-real-secret";
      process.env.TRACKING_SECRET = "another-real-secret";
      expect(loadConfig().appUrl).toBe("https://mail.example.com");
    });

    it("requires APP_URL rather than falling back to localhost", () => {
      process.env.JWT_SECRET = "a-real-secret";
      process.env.TRACKING_SECRET = "another-real-secret";
      delete process.env.APP_URL;
      expect(() => loadConfig()).toThrow(/APP_URL/);
    });
  });
});
