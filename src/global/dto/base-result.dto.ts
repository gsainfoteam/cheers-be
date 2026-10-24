export class BaseResultDto {
  result: string;

  static OK: BaseResultDto = {
    result: "OK",
  };

  static UNKNOWN: BaseResultDto = {
    result: "UNKNOWN",
  };
}
