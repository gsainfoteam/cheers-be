import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { INTEREST_PK_MAX } from "@src/manager/interest/dto/admin-interest.dto";

@Injectable()
export class ParseInterestPkPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const pk = Number(value);
    if (!/^[1-9]\d*$/.test(value) || pk > INTEREST_PK_MAX) {
      throw new BadRequestException("pk must be a positive integer.");
    }
    return pk;
  }
}
