import type { OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { createPublicKey, generateKeyPair } from "node:crypto";
import { promisify } from "node:util";
import {
  JwtSigningKeyRepository,
  JwtSigningKeyRow,
} from "@src/database/repository/jwt-signing-key.repository";

const generateKeyPairAsync = promisify(generateKeyPair);

const RSA_MODULUS_LENGTH = 2048;

type SigningKeyPair = Pick<JwtSigningKeyRow, "privateKey" | "publicKey">;

// JWT 서명 키의 출처는 DB 하나. 기동 때 읽어 메모리에 두고, app.listen은 이 작업이 끝난 뒤에 요청을 받음
@Injectable()
export class JwtKeyService implements OnModuleInit {
  private readonly logger = new Logger(JwtKeyService.name);
  private keyPair: SigningKeyPair | null = null;

  constructor(
    private readonly jwtSigningKeyRepository: JwtSigningKeyRepository,
  ) {}

  async onModuleInit() {
    // 조회 오류는 잡지 않음. 읽기 실패로 새 키를 만들면 기존 토큰이 전부 무효가 되므로 기동을 실패시킴
    const stored =
      (await this.jwtSigningKeyRepository.find()) ?? (await this.create());
    this.assertKeyPairMatches(stored);
    this.keyPair = stored;
  }

  get privateKey(): string {
    return this.loaded().privateKey;
  }

  get publicKey(): string {
    return this.loaded().publicKey;
  }

  private async create(): Promise<SigningKeyPair> {
    const generated = await generateKeyPairAsync("rsa", {
      modulusLength: RSA_MODULUS_LENGTH,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const inserted =
      await this.jwtSigningKeyRepository.insertIfAbsent(generated);
    if (inserted) {
      this.logger.log("Created a new JWT signing key");
      return inserted;
    }

    // 다른 replica가 먼저 넣음. 모든 replica가 같은 키를 쓰도록 내가 만든 키는 버림
    const winner = await this.jwtSigningKeyRepository.find();
    if (!winner) {
      throw new Error("JWT signing key is missing after a conflicting insert.");
    }
    return winner;
  }

  // 깨진 키로 뜨면 서명이나 검증이 요청마다 실패하므로 기동 때 막음. 새 키로 조용히 덮어쓰지 않음
  private assertKeyPairMatches({ privateKey, publicKey }: SigningKeyPair) {
    const derived = createPublicKey(privateKey).export({
      type: "spki",
      format: "der",
    });
    const stored = createPublicKey(publicKey).export({
      type: "spki",
      format: "der",
    });
    if (!derived.equals(stored)) {
      throw new Error("JWT signing key pair does not match.");
    }
  }

  private loaded(): SigningKeyPair {
    if (!this.keyPair) {
      throw new Error("JWT signing key is not loaded yet.");
    }
    return this.keyPair;
  }
}
