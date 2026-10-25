import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import { StringValue } from "ms";
import { DatabaseService } from "@src/database/database.service";
import { RefreshTokenRepository } from "@src/database/repository/refresh-token.repository";
import { UserRepository } from "@src/database/repository/user.repository";
import { TxType } from "@src/global/types/tx.types";
import {
  AccessTokenPayload,
  IssuedTokens,
  TokenSubject,
} from "@src/auth/auth.types";

const ISSUER = "Cheers";
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly accessTokenExpiresIn: StringValue;
  private readonly refreshTokenExpireDays: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly dbService: DatabaseService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly userRepository: UserRepository,
  ) {
    const privateKey = this.configService.get<string>("JWT_PRIVATE_KEY");
    const publicKey = this.configService.get<string>("JWT_PUBLIC_KEY");
    if (!privateKey || !publicKey) {
      throw new Error("JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required.");
    }
    // env에 한 줄로 넣을 수 있도록 \n 이스케이프 허용
    this.privateKey = privateKey.replace(/\\n/g, "\n");
    this.publicKey = publicKey.replace(/\\n/g, "\n");

    // 가드는 DB를 보지 않고 토큰 클레임만 믿으므로, 탈퇴 · 유형 변경 · 가입 미완료 정리 후에도
    // 기존 access token은 만료까지 통과함. 그 최대 노출 시간이 access token 수명이라 1시간으로 유지
    const accessTokenExpiresIn =
      this.configService.get<string>("ACCESS_TOKEN_EXPIRES_IN") ?? "1h";
    if (!/^\d+[smhd]$/.test(accessTokenExpiresIn)) {
      throw new Error(
        `ACCESS_TOKEN_EXPIRES_IN must look like 30m, 1h (got "${accessTokenExpiresIn}").`,
      );
    }
    this.accessTokenExpiresIn = accessTokenExpiresIn as StringValue;

    const refreshTokenExpireDays = Number(
      this.configService.get<string>("REFRESH_TOKEN_EXPIRE_DAYS") ?? 30,
    );
    if (
      !Number.isInteger(refreshTokenExpireDays) ||
      refreshTokenExpireDays <= 0
    ) {
      throw new Error(
        "REFRESH_TOKEN_EXPIRE_DAYS must be a positive integer (number of days).",
      );
    }
    this.refreshTokenExpireDays = refreshTokenExpireDays;
  }

  // 로그인, 토큰 갱신, 가입 완료 시 호출. 최근 접속 시각도 같이 갱신
  async issueTokens(user: TokenSubject, tx: TxType): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = {
      sub: user.pk,
      type: user.type,
      status: user.status,
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      algorithm: "RS256",
      privateKey: this.privateKey,
      issuer: ISSUER,
      expiresIn: this.accessTokenExpiresIn,
    });

    // 원문은 클라이언트에만 주고 DB에는 해시만 저장
    const refreshToken = randomBytes(32).toString("base64url");
    await this.refreshTokenRepository.insert(
      {
        opaqueHash: this.hashRefreshToken(refreshToken),
        userPk: user.pk,
        expiresAt: new Date(Date.now() + this.refreshTokenExpireDays * DAY_MS),
      },
      tx,
    );
    await this.userRepository.updateLastActiveAt(user.pk, tx);

    return { accessToken, refreshToken };
  }

  // rotation: 기존 토큰 삭제 후 DB의 현재 status / type으로 새 토큰 발급
  async refresh(rawRefreshToken: string): Promise<IssuedTokens> {
    return this.dbService.db.transaction(async (tx) => {
      const stored = await this.refreshTokenRepository.deleteByOpaqueHash(
        this.hashRefreshToken(rawRefreshToken),
        tx,
      );
      if (!stored) {
        throw new UnauthorizedException("Invalid refresh token");
      }
      if (stored.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException("Refresh token expired");
      }

      const user = await this.userRepository.findByPk(stored.userPk, tx);
      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      return this.issueTokens(user, tx);
    });
  }

  // 이미 없는 토큰이어도 성공으로 처리
  async logout(rawRefreshToken: string, userPk: string): Promise<void> {
    await this.refreshTokenRepository.deleteByOpaqueHashAndUserPk(
      this.hashRefreshToken(rawRefreshToken),
      userPk,
    );
  }

  // 회원 탈퇴, 유형 변경, 가입 완료(토큰 재발급 전) 때 사용
  async revokeAllTokens(userPk: string, tx: TxType): Promise<void> {
    await this.refreshTokenRepository.deleteByUserPk(userPk, tx);
  }

  // 내 정보 조회 때 호출
  async touchLastActive(userPk: string): Promise<void> {
    await this.userRepository.updateLastActiveAt(userPk);
  }

  async verifyAccessToken(accessToken: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<AccessTokenPayload>(
        accessToken,
        {
          algorithms: ["RS256"],
          publicKey: this.publicKey,
          issuer: ISSUER,
        },
      );
    } catch (e) {
      this.logger.debug(`Invalid access token: ${(e as Error).message}`);
      if ((e as Error).name === "TokenExpiredError") {
        throw new UnauthorizedException("Token expired", { cause: e });
      }
      throw new UnauthorizedException("Invalid token", { cause: e });
    }
  }

  private hashRefreshToken(rawRefreshToken: string): string {
    return createHash("sha256").update(rawRefreshToken).digest("hex");
  }
}
