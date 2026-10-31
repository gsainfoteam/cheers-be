import { AdminAccountRole } from "@src/admin-repository/admin-account.repository";

export class ManagerContext {
  constructor(
    readonly pk: string,
    readonly email: string,
    readonly role: AdminAccountRole,
  ) {}
}
