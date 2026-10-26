export type UploadUrl = {
  url: string;
  // 업로드할 tmp key. 업로드 후 기능 API에 제출
  key: string;
  // PUT 요청에 그대로 붙일 헤더
  headers: Record<string, string>;
  expiresIn: number;
};
