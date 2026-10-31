import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ManagerRequest } from "@src/manager/guard/manager.guard";

// ManagerGuard 다음에 붙여서 사용
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { manager } = context.switchToHttp().getRequest<ManagerRequest>();
    if (manager?.role !== "superadmin") {
      throw new ForbiddenException("Superadmin privilege is required.");
    }
    return true;
  }
}
