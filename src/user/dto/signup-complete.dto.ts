// 추가 정보 저장 API 응답. 이번 호출로 가입이 완료됐을 때만 새 토큰을 줌
export class SignupCompleteResponseDto {
  result: string;
  access_token?: string;
  refresh_token?: string;
}
