import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { COMPANY_PK_MAX } from "@src/company/company.utils";

// company_alias.pk · company_name.pk 경로 파라미터. integer 범위를 넘는 값은 DB 오류(500)가 되므로 먼저 400
@Injectable()
export class ParseCompanyPkPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const pk = Number(value);
    if (!/^[1-9]\d*$/.test(value) || pk > COMPANY_PK_MAX) {
      throw new BadRequestException("pk must be a positive integer.");
    }
    return pk;
  }
}
