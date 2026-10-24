import { HttpException, HttpStatus } from "@nestjs/common";

export class CheersDBError extends HttpException {
  constructor(message: string, cause?: unknown) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR, {
      cause,
    });
  }
}
