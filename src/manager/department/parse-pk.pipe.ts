import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

const INT4_MAX = 2147483647;

// ParseIntPipe는 int4 범위를 넘는 값도 통과시켜 DB에서 500이 되므로 여기서 400으로 막음
@Injectable()
export class ParsePkPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const pk = /^\d+$/.test(value) ? Number(value) : 0;
    if (pk < 1 || pk > INT4_MAX) {
      throw new BadRequestException("Invalid pk");
    }
    return pk;
  }
}
