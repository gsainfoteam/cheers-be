import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { SignupStepGuard } from "@src/auth/guard/signup-step.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { DepartmentListResponseDto } from "./dto/departments.dto";
import {
  SaveStudentInfoRequestDto,
  SaveStudentInfoResponseDto,
} from "./dto/save-student-info.dto";
import { SendCodeRequestDto, SendCodeResponseDto } from "./dto/send-code.dto";
import { VerifyCodeRequestDto } from "./dto/verify-code.dto";
import { StudentVerificationService } from "./student-verification.service";
import { StudentService } from "./student.service";

// API 명세 "재학생" 섹션. SignupStepGuard가 DB 값으로 request.user를 채운 뒤 UserTypeGuard가 유형을 봄
@Controller("/api/v1/user/student")
@UseGuards(SignupStepGuard, UserTypeGuard)
@UserTypes(["student"])
export class StudentController {
  constructor(
    private readonly studentVerificationService: StudentVerificationService,
    private readonly studentService: StudentService,
  ) {}

  @Post("/verify/send-code")
  @SignupStep({ step: "verify" })
  async sendCode(
    @Body() req: SendCodeRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<SendCodeResponseDto> {
    return this.studentVerificationService.sendCode(user.userPk, req.email);
  }

  @Post("/verify/code")
  @SignupStep({ step: "verify" })
  async verifyCode(
    @Body() req: VerifyCodeRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<BaseResultDto> {
    return this.studentVerificationService.verifyCode(user.userPk, req.code);
  }

  @Get("/departments")
  @SignupStep({ step: "profile", allowActive: true })
  async getDepartments(
    @CurrentUser() user: UserContext,
  ): Promise<DepartmentListResponseDto> {
    return this.studentService.getDepartments(user.userPk);
  }

  @Post("/info")
  @SignupStep({ step: "profile", allowActive: true })
  async saveInfo(
    @Body() req: SaveStudentInfoRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<SaveStudentInfoResponseDto> {
    return this.studentService.saveInfo(user.userPk, req);
  }
}
