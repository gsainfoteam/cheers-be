import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { SlackService } from "nestjs-slack";
import { AllExceptionsFilter } from "./all-exception.filter";

describe("AllExceptionsFilter", () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: "POST", url: "/api" }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter({
    sendText: jest.fn().mockResolvedValue(undefined),
  } as unknown as SlackService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes extra fields of an object response through", () => {
    filter.catch(
      new BadRequestException({
        message: "Invalid verification code",
        remaining_attempts: 3,
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      remaining_attempts: 3,
      statusCode: 400,
      message: "Invalid verification code",
    });
  });

  it("keeps the plain { statusCode, message } shape otherwise", () => {
    filter.catch(new NotFoundException("No verification in progress"), host);

    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      message: "No verification in progress",
    });
  });
});
