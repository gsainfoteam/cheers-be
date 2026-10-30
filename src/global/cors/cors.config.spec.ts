import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCorsOptions, parseCorsOrigins } from "./cors.config";

describe("parseCorsOrigins", () => {
  it("parses a comma separated list and trims whitespace", () => {
    expect(
      parseCorsOrigins(" https://a.example.com , http://localhost:5173 "),
    ).toEqual(["https://a.example.com", "http://localhost:5173"]);
  });

  it("normalizes entries to the form browsers send as Origin", () => {
    expect(
      parseCorsOrigins(
        "https://a.example.com/,HTTPS://B.Example.com,https://c.example.com:443",
      ),
    ).toEqual([
      "https://a.example.com",
      "https://b.example.com",
      "https://c.example.com",
    ]);
  });

  it("removes duplicates after normalizing", () => {
    expect(
      parseCorsOrigins("https://a.example.com,https://a.example.com/"),
    ).toEqual(["https://a.example.com"]);
  });

  it("ignores empty entries", () => {
    expect(parseCorsOrigins("https://a.example.com,, ,")).toEqual([
      "https://a.example.com",
    ]);
  });

  it.each([undefined, "", "   ", ","])("returns no origins for %p", (raw) => {
    expect(parseCorsOrigins(raw)).toEqual([]);
  });

  it.each([
    "*",
    "https://*.example.com",
    "a.example.com",
    "localhost:5173",
    "ftp://a.example.com",
    "https://a.example.com/path",
    "https://a.example.com?x=1",
    "https://a.example.com#x",
    "https://user:pw@a.example.com",
    "null",
  ])("throws on %s", (value) => {
    expect(() => parseCorsOrigins(`https://ok.example.com,${value}`)).toThrow(
      `Invalid CORS_ALLOWED_ORIGINS entry: "${value}"`,
    );
  });
});

describe("createCorsOptions", () => {
  const createConfig = (env: Record<string, string | undefined>) =>
    ({ get: (key: string) => env[key] }) as unknown as ConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows only the configured origins without credentials", () => {
    expect(
      createCorsOptions(
        createConfig({
          CORS_ALLOWED_ORIGINS: "https://a.example.com",
          NODE_ENV: "production",
        }),
      ),
    ).toEqual({
      origin: ["https://a.example.com"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Authorization", "Content-Type"],
      credentials: false,
      maxAge: 600,
    });
  });

  it("throws in production when no origin is set", () => {
    expect(() =>
      createCorsOptions(
        createConfig({ CORS_ALLOWED_ORIGINS: " ", NODE_ENV: "production" }),
      ),
    ).toThrow("CORS_ALLOWED_ORIGINS is required in production.");
  });

  it("rejects every origin with a warning outside production", () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();

    expect(createCorsOptions(createConfig({})).origin).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("CORS_ALLOWED_ORIGINS is not set"),
    );
  });

  it("throws on an invalid entry outside production", () => {
    expect(() =>
      createCorsOptions(createConfig({ CORS_ALLOWED_ORIGINS: "*" })),
    ).toThrow("Invalid CORS_ALLOWED_ORIGINS entry");
  });
});
