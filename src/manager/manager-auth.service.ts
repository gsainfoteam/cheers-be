import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { JwtKeyService } from "@src/auth/jwt-key.service";
import { AdminAccountRepository } from "@src/admin-repository/admin-account.repository";
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
