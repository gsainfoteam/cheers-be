import { ValidationPipe } from "@nestjs/common";
import { CreateRequestDto } from "./dto/create-request.dto";
import { GraduatedListQueryDto } from "./dto/graduated-list.dto";
import { PaginationQueryDto } from "./dto/pagination.dto";

// main.ts와 같은 설정
const pipe = new ValidationPipe({
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const validate = <T>(metatype: new () => T, value: object, type = "query") =>
  pipe.transform(value, {
    type: type as "query" | "body",
    metatype,
  }) as Promise<T>;

describe("cheers DTOs", () => {
  describe("GraduatedListQueryDto", () => {
    it("applies defaults", async () => {
      const dto = await validate(GraduatedListQueryDto, {});

      expect(dto).toMatchObject({ sort: "recent_joined", page: 1, size: 20 });
    });

    it("converts query strings to numbers", async () => {
      const dto = await validate(GraduatedListQueryDto, {
        sort: "random",
        page: "2",
        size: "50",
      });

      expect(dto).toMatchObject({ sort: "random", page: 2, size: 50 });
    });

    it.each([
      { sort: "popular" },
      { page: "0" },
      { page: "abc" },
      { size: "51" },
      { size: "1.5" },
    ])("rejects %o", async (value) => {
      await expect(validate(GraduatedListQueryDto, value)).rejects.toThrow(
        "Bad Request Exception",
      );
    });
  });

  it("PaginationQueryDto rejects size over 50", async () => {
    await expect(validate(PaginationQueryDto, { size: "100" })).rejects.toThrow(
      "Bad Request Exception",
    );
  });

  describe("CreateRequestDto", () => {
    const graduatedId = "8f1d2c3b-1111-4a2b-9c8d-0e1f2a3b4c5d";

    it("trims the message", async () => {
      const dto = await validate(
        CreateRequestDto,
        { graduated_id: graduatedId, message: "  궁금합니다  " },
        "body",
      );

      expect(dto.message).toBe("궁금합니다");
    });

    it.each([
      { graduated_id: "not-a-uuid", message: "궁금합니다" },
      { graduated_id: graduatedId, message: "   " },
      { graduated_id: graduatedId, message: "가".repeat(201) },
      { graduated_id: graduatedId },
    ])("rejects %#", async (value) => {
      await expect(validate(CreateRequestDto, value, "body")).rejects.toThrow(
        "Bad Request Exception",
      );
    });

    it("accepts a 200-character message", async () => {
      await expect(
        validate(
          CreateRequestDto,
          { graduated_id: graduatedId, message: "가".repeat(200) },
          "body",
        ),
      ).resolves.toBeDefined();
    });
  });
});
