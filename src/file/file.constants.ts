export const FileDirectory = {
  BUSINESS_CARD: "business-card",
} as const;

export type FileDirectory = (typeof FileDirectory)[keyof typeof FileDirectory];

export interface FileUploadPolicy {
  maxSize: number;
  allowedMimeTypes: string[];
}

export const BUSINESS_CARD_FILE_POLICY: FileUploadPolicy = {
  maxSize: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/heic", "image/heif"],
};
