import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { ManagerContext } from "@src/manager/context/manager-context";
import { ManagerRequest } from "@src/manager/guard/manager.guard";

// ManagerGuard가 담은 ManagerContext
export const CurrentManager = createParamDecorator(
  (_: unknown, context: ExecutionContext): ManagerContext =>
    context.switchToHttp().getRequest<ManagerRequest>().manager,
);
