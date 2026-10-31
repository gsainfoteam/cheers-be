import { AdminAccountRole } from "@src/database/repository/admin-account.repository";

export class ManagerContext {
  constructor(
    readonly pk: string,
    readonly email: string,
    readonly role: AdminAccountRole,
  ) {}
}
