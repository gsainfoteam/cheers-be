import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { JwtKeyService } from "@src/auth/jwt-key.service";
import { AdminAccountRepository } from "@src/admin-repository/admin-account.repository";
import { AdminAuditLogRepository } from "@src/admin-repository/admin-audit-log.repository";
import { DatabaseService } from "@src/database/database.service";
import { InfoteamIdpService } from "@src/manager/infoteam-idp.service";
import { normalizeEmail } from "@src/manager/manager-email";

// 사용자 토큰(issuer "Cheers")과 키는 같고 issuer로 구분. 서로의 가드에서 거부됨
const ISSUER = "Cheers-Manager";
const ACCESS_TOKEN_EXPIRES_IN = "1d";

// role은 넣지 않음. ManagerGuard가 요청마다 DB의 현재 값을 읽음
export type ManagerTokenPayload = { sub: string };

@Injectable()
export class ManagerAuthService {
  private readonly logger = new Logger(ManagerAuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly jwtKeyService: JwtKeyService,
    private readonly infoteamIdpService: InfoteamIdpService,
    private readonly adminAccountRepository: AdminAccountRepository,
    private readonly dbService: DatabaseService,
    private readonly adminAuditLogRepository: AdminAuditLogRepository,
  ) {}

  async login(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<string> {
    const idpAccessToken =
      await this.infoteamIdpService.exchangeAuthorizationCode(
        code,
        redirectUri,
        codeVerifier,
      );
    const email = await this.infoteamIdpService.getEmail(idpAccessToken);

    const account = email
      ? await this.adminAccountRepository.findByEmail(normalizeEmail(email))
      : null;
    if (!account) {
      throw new ForbiddenException("This account is not allowed as a manager.");
    }

    // 감사 로그(CRB-81): 토큰을 내주기 전에 남기고, 기록이 실패하면 로그인도 실패.
    // 허용 목록에 없는 시도는 어드민이 아니라서 남기지 않음 (403은 위에서 이미 던짐)
    await this.dbService.db.transaction((tx) =>
      this.adminAuditLogRepository.insert(
        {
          adminEmail: account.email,
          action: "admin_auth.login",
          targetType: "admin_account",
          targetId: account.pk,
        },
        tx,
      ),
    );

    const payload: ManagerTokenPayload = { sub: account.pk };
    return this.jwtService.signAsync(payload, {
      algorithm: "RS256",
      privateKey: this.jwtKeyService.privateKey,
      issuer: ISSUER,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });
  }

  async verifyAccessToken(accessToken: string): Promise<ManagerTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<ManagerTokenPayload>(
        accessToken,
        {
          algorithms: ["RS256"],
          publicKey: this.jwtKeyService.publicKey,
          issuer: ISSUER,
        },
      );
    } catch (e) {
      this.logger.debug(`Invalid manager token: ${(e as Error).message}`);
      if ((e as Error).name === "TokenExpiredError") {
        throw new UnauthorizedException("Token expired", { cause: e });
      }
      throw new UnauthorizedException("Invalid token", { cause: e });
    }
  }
}
