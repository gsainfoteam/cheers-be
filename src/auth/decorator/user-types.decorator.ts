import { Reflector } from "@nestjs/core";
import { UserType } from "@src/auth/auth.types";

// UserTypeGuard와 같이 사용
export const UserTypes = Reflector.createDecorator<UserType[]>();
