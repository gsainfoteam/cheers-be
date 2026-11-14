import { createE2eApp, E2eContext } from "./support/app";
import {
  agreeConsents,
  bearer,
  getInfo,
  http,
  JPEG_BYTES,
  login,
  PDF_BYTES,
  saveStudentInfo,
  Session,
  signupGraduated,
  signupStudent,
  uploadAttachment,
} from "./support/flows";

const CARD_URL = "/api/v1/file/business-card/upload-url";
const ATTACHMENT_URL = "/api/v1/file/attachment/upload-url";
const MB = 1024 * 1024;

describe("파일 업로드 오류 (가짜 S3)", () => {
  let ctx: E2eContext;

  const uploadUrl = (session: Session, path: string, body: object) =>
    http(ctx).post(path).set("Authorization", bearer(session)).send(body);

  const submitCard = (session: Session, key: string) =>
    http(ctx)
      .post("/api/v1/user/graduated/verify/business-card")
      .set("Authorization", bearer(session))
      .send({ key });

  // 약관 동의까지 마친 현업자 (명함 제출 단계)
  const graduatedAtCardStep = async () => {
    const session = await login(ctx, "graduated");
    await agreeConsents(ctx, session);
    return session;
  };

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  beforeEach(() => ctx.reset());
  afterAll(() => ctx.close());

  describe("업로드 URL 발급", () => {
    it("명함: 이미지가 아니면 400, 10MB를 넘으면 413", async () => {
      const session = await graduatedAtCardStep();
      await uploadUrl(session, CARD_URL, {
        content_type: "application/pdf",
        size: 10,
      }).expect(400);
      await uploadUrl(session, CARD_URL, {
        content_type: "image/jpeg",
        size: 10 * MB + 1,
      }).expect(413);
      await uploadUrl(session, CARD_URL, {
        content_type: "image/jpeg",
        size: 10 * MB,
      }).expect(201);
    });

    it("첨부: PDF가 아니면 400, 20MB를 넘으면 413", async () => {
      const session = await signupStudent(ctx);
      await uploadUrl(session, ATTACHMENT_URL, {
        content_type: "image/png",
        size: 10,
      }).expect(400);
      await uploadUrl(session, ATTACHMENT_URL, {
        content_type: "application/pdf",
        size: 20 * MB + 1,
      }).expect(413);
    });

    it("명함은 현업자만, 첨부는 재학생만 받음 (403), 가입 중인 재학생도 첨부는 받음", async () => {
      const student = await signupStudent(ctx);
      const graduated = await signupGraduated(ctx);
      const pendingStudent = await login(ctx, "student");
      await agreeConsents(ctx, pendingStudent);

      const card = { content_type: "image/jpeg", size: JPEG_BYTES.length };
      const pdf = { content_type: "application/pdf", size: PDF_BYTES.length };
      await uploadUrl(student, CARD_URL, card).expect(403);
      await uploadUrl(graduated, ATTACHMENT_URL, pdf).expect(403);
      await uploadUrl(pendingStudent, ATTACHMENT_URL, pdf).expect(201);
      await http(ctx).post(CARD_URL).send(card).expect(401);
    });
  });

  describe("업로드한 파일 제출", () => {
    it("명함: 다른 유저의 key · 업로드하지 않은 key는 400이고 다음 단계로 넘어가지 않음", async () => {
      const mine = await graduatedAtCardStep();
      const other = await graduatedAtCardStep();
      const card = { content_type: "image/jpeg", size: JPEG_BYTES.length };

      const othersUpload = await uploadUrl(other, CARD_URL, card).expect(201);
      ctx.s3.put(othersUpload.body.key, JPEG_BYTES);
      await submitCard(mine, othersUpload.body.key).expect(400);

      const notUploaded = await uploadUrl(mine, CARD_URL, card).expect(201);
      await submitCard(mine, notUploaded.body.key).expect(400);

      expect(await getInfo(ctx, mine)).toMatchObject({
        status: "pending",
        next_step: "verify",
      });
      // 다른 유저의 파일은 지우지 않음
      expect(ctx.s3.objects.has(othersUpload.body.key)).toBe(true);
    });

    it("명함: 선언과 내용이 다른 파일은 400이고 tmp 파일을 지움", async () => {
      const session = await graduatedAtCardStep();
      const upload = await uploadUrl(session, CARD_URL, {
        content_type: "image/jpeg",
        size: PDF_BYTES.length,
      }).expect(201);
      ctx.s3.put(upload.body.key, PDF_BYTES);

      await submitCard(session, upload.body.key).expect(400);
      expect(ctx.s3.objects.has(upload.body.key)).toBe(false);
    });

    it("첨부: 다른 유저의 key · PDF가 아닌 파일은 400이고 프로필이 그대로", async () => {
      const session = await signupStudent(ctx);
      const other = await signupStudent(ctx);
      const othersKey = await uploadAttachment(ctx, other);

      // 학과 · 관심사 · 연락처는 올바른 값으로 채우고 첨부만 바꿔 보냄
      const departments = await http(ctx)
        .get("/api/v1/user/student/departments")
        .set("Authorization", bearer(session))
        .expect(200);
      const interests = await http(ctx)
        .get("/api/v1/user/student/interests")
        .set("Authorization", bearer(session))
        .expect(200);
      const saveWith = (key: string) =>
        http(ctx)
          .post("/api/v1/user/student/info")
          .set("Authorization", bearer(session))
          .send({
            name: "김재학",
            department_id: departments.body.departments[0].id,
            interests: [interests.body.interests[0]],
            contact: {
              email_enabled: true,
              kakao_enabled: false,
              email: "student-contact@example.com",
            },
            attachments: [
              { kind: "cv", source: "file", key, file_name: "cv.pdf" },
            ],
          });

      await saveWith(othersKey).expect(400);

      const upload = await uploadUrl(session, ATTACHMENT_URL, {
        content_type: "application/pdf",
        size: JPEG_BYTES.length,
      }).expect(201);
      ctx.s3.put(upload.body.key, JPEG_BYTES);
      await saveWith(upload.body.key).expect(400);
      expect(ctx.s3.objects.has(upload.body.key)).toBe(false);

      expect((await getInfo(ctx, session)).student.profile.attachments).toEqual(
        [],
      );
      // 올바른 파일이면 저장됨 (위 실패가 다른 검증 때문이 아님을 확인)
      await saveStudentInfo(ctx, session, {
        attachments: [
          {
            kind: "cv",
            source: "file",
            key: await uploadAttachment(ctx, session),
            file_name: "cv.pdf",
          },
        ],
      });
    });
  });
});
