import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { SignupStepGuard } from "@src/auth/guard/signup-step.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { ApiTags } from "@nestjs/swagger";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import { DepartmentListResponseDto } from "./dto/departments.dto";
import { InterestListResponseDto } from "./dto/interests.dto";
import { SignupCompleteResponseDto } from "@src/user/dto/signup-complete.dto";
import { SaveStudentInfoRequestDto } from "./dto/save-student-info.dto";
import {
  EmailAlreadyRegisteredErrorDto,
  SendCodeRateLimitErrorDto,
  SendCodeRequestDto,
  SendCodeResponseDto,
} from "./dto/send-code.dto";
import {
  VerifyCodeErrorDto,
  VerifyCodeRequestDto,
} from "./dto/verify-code.dto";
import { StudentVerificationService } from "./student-verification.service";
import { StudentService } from "./student.service";

// API 명세 "재학생" 섹션. SignupStepGuard가 DB 값으로 request.user를 채운 뒤 UserTypeGuard가 유형을 봄
@ApiTags("재학생")
@ApiAuth()
@Controller("/api/v1/user/student")
@UseGuards(SignupStepGuard, UserTypeGuard)
@UserTypes(["student"])
export class StudentController {
  constructor(
    private readonly studentVerificationService: StudentVerificationService,
    private readonly studentService: StudentService,
  ) {}

  /** 재학생 이메일 인증코드 발송 */
  @Post("/verify/send-code")
  @SignupStep({ step: "verify" })
  @ApiErrors({
    400: "요청 형식 오류, 허용되지 않은 이메일 도메인",
    403: "재학생이 아님, next_step이 verify가 아님, 이미 가입을 마침",
    409: {
      description: "이미 다른 계정에서 인증한 이메일",
      type: EmailAlreadyRegisteredErrorDto,
    },
    429: {
      description: "재전송 대기 시간이 지나지 않음, 발송 횟수 초과",
      type: SendCodeRateLimitErrorDto,
    },
  })
  async sendCode(
    @Body() req: SendCodeRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<SendCodeResponseDto> {
    return this.studentVerificationService.sendCode(user.userPk, req.email);
  }

  /** 재학생 이메일 인증코드 확인 */
  @Post("/verify/code")
  @SignupStep({ step: "verify" })
  @ApiErrors({
    400: {
      description:
        "인증코드 형식 오류, 인증코드가 틀림 (틀린 경우 remaining_attempts 포함)",
      type: VerifyCodeErrorDto,
    },
    403: "재학생이 아님, next_step이 verify가 아님, 이미 가입을 마침",
    404: "진행 중인 인증 요청이 없음",
    410: "인증코드 만료",
  })
  async verifyCode(
    @Body() req: VerifyCodeRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<BaseResultDto> {
    return this.studentVerificationService.verifyCode(user.userPk, req.code);
  }

  /** 인증한 이메일의 학교에 속한 학과 목록 */
  @Get("/departments")
  @SignupStep({ step: "profile", allowActive: true })
  @ApiErrors({
    403: "재학생이 아님, 가입 중인데 next_step이 profile이 아님",
    404: "인증한 이메일이 없음",
  })
  async getDepartments(
    @CurrentUser() user: UserContext,
  ): Promise<DepartmentListResponseDto> {
    return this.studentService.getDepartments(user.userPk);
  }

  /** 관심 분야 목록 */
  @Get("/interests")
  @SignupStep({ step: "profile", allowActive: true })
  @ApiErrors({
    403: "재학생이 아님, 가입 중인데 next_step이 profile이 아님",
  })
  getInterests(): InterestListResponseDto {
    return this.studentService.getInterests();
  }

  /** 재학생 추가 정보 저장 (가입 후에는 수정) */
  @Post("/info")
  @SignupStep({ step: "profile", allowActive: true })
  @ApiErrors({
    400: "요청 형식 오류, 다른 학교의 학과, 연락 방법을 고르지 않음, 연락처 누락, 이름 누락, 첨부 파일 key 오류",
    403: "재학생이 아님, 가입 중인데 next_step이 profile이 아님",
    404: "인증한 이메일이 없음",
  })
  async saveInfo(
    @Body() req: SaveStudentInfoRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<SignupCompleteResponseDto> {
    return this.studentService.saveInfo(user.userPk, req);
  }
}
