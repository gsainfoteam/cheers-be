import { generateKeyPairSync } from "node:crypto";
import { JwtKeyService } from "@src/auth/jwt-key.service";
import { JwtSigningKeyRepository } from "@src/database/repository/jwt-signing-key.repository";

const pem = () =>
  generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

describe("JwtKeyService", () => {
  const existing = pem();
  const other = pem();

  const repository = {
    find: jest.fn(),
    insertIfAbsent: jest.fn(),
  };
  let service: JwtKeyService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new JwtKeyService(
      repository as unknown as JwtSigningKeyRepository,
    );
  });

  it("uses the stored key without generating a new one", async () => {
    repository.find.mockResolvedValue(existing);

    await service.onModuleInit();

    expect(service.privateKey).toBe(existing.privateKey);
    expect(service.publicKey).toBe(existing.publicKey);
    expect(repository.insertIfAbsent).not.toHaveBeenCalled();
  });

  it("generates and stores a valid pair when the database has none", async () => {
    repository.find.mockResolvedValue(null);
    repository.insertIfAbsent.mockImplementation((row: unknown) =>
      Promise.resolve(row),
    );

    await service.onModuleInit();

    expect(repository.insertIfAbsent).toHaveBeenCalledTimes(1);
    const inserted = repository.insertIfAbsent.mock.calls[0][0] as {
      privateKey: string;
      publicKey: string;
    };
    expect(inserted.privateKey).toContain("BEGIN PRIVATE KEY");
    expect(inserted.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(service.privateKey).toBe(inserted.privateKey);
    expect(service.publicKey).toBe(inserted.publicKey);
  });

  it("uses the winner's key after losing the insert race", async () => {
    repository.find.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    repository.insertIfAbsent.mockResolvedValue(null);

    await service.onModuleInit();

    expect(repository.find).toHaveBeenCalledTimes(2);
    expect(service.privateKey).toBe(existing.privateKey);
    expect(service.publicKey).toBe(existing.publicKey);
  });

  it("throws when the row is still missing after losing the insert race", async () => {
    repository.find.mockResolvedValue(null);
    repository.insertIfAbsent.mockResolvedValue(null);

    await expect(service.onModuleInit()).rejects.toThrow(
      "JWT signing key is missing after a conflicting insert.",
    );
  });

  it("does not generate a key when reading fails", async () => {
    repository.find.mockRejectedValue(new Error("connection refused"));

    await expect(service.onModuleInit()).rejects.toThrow("connection refused");
    expect(repository.insertIfAbsent).not.toHaveBeenCalled();
  });

  it("throws when the stored pair does not match", async () => {
    repository.find.mockResolvedValue({
      privateKey: existing.privateKey,
      publicKey: other.publicKey,
    });

    await expect(service.onModuleInit()).rejects.toThrow(
      "JWT signing key pair does not match.",
    );
    expect(repository.insertIfAbsent).not.toHaveBeenCalled();
    expect(() => service.privateKey).toThrow(
      "JWT signing key is not loaded yet.",
    );
  });

  it("throws when keys are read before loading", () => {
    expect(() => service.privateKey).toThrow(
      "JWT signing key is not loaded yet.",
    );
    expect(() => service.publicKey).toThrow(
      "JWT signing key is not loaded yet.",
    );
  });
});
