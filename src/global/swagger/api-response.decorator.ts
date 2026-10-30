import { applyDecorators, Type } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiResponse,
  getSchemaPath,
} from "@nestjs/swagger";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import { ErrorResponseDto } from "@src/global/dto/error-response.dto";

// 상태 코드별 에러 응답. 추가 필드가 있는 에러는 { description, type }으로 응답 형식을 지정
export function ApiErrors(
  errors: Record<number, string | { description: string; type: Type<unknown> }>,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...Object.entries(errors).map(([status, error]) =>
      ApiResponse({
        status: Number(status),
        ...(typeof error === "string"
          ? { description: error, type: ErrorResponseDto }
          : error),
      }),
    ),
  );
}

// access token이 필요한 API 표시 (UI의 Authorize 버튼과 연결)
export function ApiAuth(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiBearerAuth(),
    ApiErrors({ 401: "access token이 없거나 유효하지 않음" }),
  );
}

// 제네릭은 플러그인이 읽지 못해 PageResponseDto<T>의 items 형식을 직접 지정
export function ApiPageResponse(item: Type<unknown>): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(PageResponseDto, item),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageResponseDto) },
          {
            properties: {
              items: { type: "array", items: { $ref: getSchemaPath(item) } },
            },
          },
        ],
      },
    }),
  );
}
