import { eq } from "drizzle-orm";
import { graduated } from "@drizzle/schema/graduated";
import { OrphanFileService } from "@src/file/orphan-file.service";
import { createE2eApp, E2eContext } from "./support/app";
import {
  bearer,
  getInfo,
  http,
  JPEG_BYTES,
  PDF_BYTES,
  saveStudentInfo,
  signupGraduated,
  signupStudent,
} from "./support/flows";

const DAY_MS = 24 * 60 * 60 * 1000;

// S3는 test/support/fake-s3.ts의 메모리 저장소만 씀. 실제 버킷에 실행 금지
describe("시나리오 4: S3 고아 파일 정리 (가짜 S3)", () => {
  let ctx: E2eContext;
  let service: OrphanFileService;
  const now = new Date("2026-10-31T12:00:00.000Z");
  const old = new Date(now.getTime() - 2 * DAY_MS);

  // 실제 가입 흐름으로 DB가 참조하는 파일을 만들고 기준 시간 전으로 돌림
  const createReferencedFiles = async () => {
    const graduatedSession = await signupGraduated(ctx);
    const { id } = await getInfo(ctx, graduatedSession);
    const [row] = await ctx.db
      .select()
      .from(graduated)
      .where(eq(graduated.userPk, id));
    const cardKey = row.businessCardKey as string;

    const studentSession = await signupStudent(ctx);
    const upload = await http(ctx)
      .post("/api/v1/file/attachment/upload-url")
      .set("Authorization", bearer(studentSession))
      .send({ content_type: "application/pdf", size: PDF_BYTES.length })
      .expect(201);
    ctx.s3.put(upload.body.key, PDF_BYTES);
    await saveStudentInfo(ctx, studentSession, {
      attachments: [
        {
          kind: "cv",
          source: "file",
          key: upload.body.key,
          file_name: "cv.pdf",
        },
      ],
    });
    const info = await getInfo(ctx, studentSession);
    const attachmentKey = info.student.profile.attachments[0].key as string;

    ctx.s3.setLastModified(cardKey, old);
    ctx.s3.setLastModified(attachmentKey, old);
    ctx.s3.clearDeleteLog();
    return { cardKey, attachmentKey };
  };

  describe("삭제를 켠 경우", () => {
    beforeAll(async () => {
      process.env.S3_ORPHAN_DELETE_ENABLED = "true";
      ctx = await createE2eApp();
      service = ctx.app.get(OrphanFileService);
    });
    beforeEach(() => ctx.reset());
    afterAll(async () => {
      await ctx.close();
      process.env.S3_ORPHAN_DELETE_ENABLED = "";
    });

    it("참조 없는 오래된 파일만 지우고 참조 · 최근 · tmp 파일은 남김", async () => {
      const { cardKey, attachmentKey } = await createReferencedFiles();
      const orphanCard = "business-card/nobody/orphan.jpg";
      const orphanAttachment = "attachment/nobody/orphan.pdf";
      // 경계값: 정확히 24시간은 대상, 1ms 모자라면 대상 아님
      const boundary = "business-card/nobody/boundary.jpg";
      const recent = "business-card/nobody/recent.jpg";
      const temp = "tmp/business-card/nobody/old.jpg";
      ctx.s3.put(orphanCard, JPEG_BYTES, old);
      ctx.s3.put(orphanAttachment, PDF_BYTES, old);
      ctx.s3.put(boundary, JPEG_BYTES, new Date(now.getTime() - DAY_MS));
      ctx.s3.put(recent, JPEG_BYTES, new Date(now.getTime() - DAY_MS + 1));
      ctx.s3.put(temp, JPEG_BYTES, old);

      const result = await service.cleanup(now);

      expect(result).toEqual({
        scanned: 6,
        orphans: 3,
        deleted: 3,
        failed: 0,
        stopped: false,
      });
      expect([...ctx.s3.deletedKeys].sort()).toEqual(
        [orphanCard, orphanAttachment, boundary].sort(),
      );
      for (const key of [cardKey, attachmentKey, recent, temp]) {
        expect(ctx.s3.objects.has(key)).toBe(true);
      }
      expect(ctx.slack.messages).toHaveLength(0);
    });

    it("빈 DB에서는 파일이 전부 고아로 보여도 지우지 않고 알림을 보냄", async () => {
      const keys = [
        "business-card/a/1.jpg",
        "business-card/a/2.jpg",
        "attachment/a/1.pdf",
      ];
      for (const key of keys) ctx.s3.put(key, JPEG_BYTES, old);

      const result = await service.cleanup(now);

      expect(result).toMatchObject({ orphans: 3, deleted: 0, stopped: true });
      expect(ctx.s3.deletedKeys).toEqual([]);
      expect(ctx.s3.objects.size).toBe(3);
      expect(ctx.slack.messages).toHaveLength(1);
      expect(ctx.slack.messages[0]).toContain("Orphan file cleanup stopped");
    });

    it("고아 비율이 기준을 넘으면 지우지 않음", async () => {
      await createReferencedFiles();
      for (let i = 0; i < 10; i++) {
        ctx.s3.put(`business-card/a/${i}.jpg`, JPEG_BYTES, old);
      }

      const result = await service.cleanup(now);

      expect(result).toMatchObject({ orphans: 10, deleted: 0, stopped: true });
      expect(ctx.s3.deletedKeys).toEqual([]);
      expect(ctx.slack.messages).toHaveLength(1);
    });

    it("빈 버킷은 아무 일도 하지 않음", async () => {
      expect(await service.cleanup(now)).toEqual({
        scanned: 0,
        orphans: 0,
        deleted: 0,
        failed: 0,
        stopped: false,
      });
      expect(ctx.slack.messages).toHaveLength(0);
    });
  });

  describe("기본값 (삭제 꺼짐)", () => {
    beforeAll(async () => {
      ctx = await createE2eApp();
      service = ctx.app.get(OrphanFileService);
    });
    beforeEach(() => ctx.reset());
    afterAll(() => ctx.close());

    it("고아를 세기만 하고 지우지 않음", async () => {
      await createReferencedFiles();
      ctx.s3.put("business-card/nobody/orphan.jpg", JPEG_BYTES, old);

      const result = await service.cleanup(now);

      expect(result).toMatchObject({ orphans: 1, deleted: 0, stopped: false });
      expect(ctx.s3.deletedKeys).toEqual([]);
      expect(ctx.s3.objects.has("business-card/nobody/orphan.jpg")).toBe(true);
    });
  });
});
