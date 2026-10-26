import { FileValidator, ParseFilePipe } from "@nestjs/common";
import { FileUploadPolicy } from "./file.constants";
import { detectFileMimeType } from "./file.utils";

/**
 * checks the file content (magic numbers) against the policy's MIME types
 * the interceptor only checks the Content-Type the client sent,
 * so an HTML file sent as image/png passes there but fails here
 */
export class FileContentValidator extends FileValidator<FileUploadPolicy> {
  isValid(file?: Express.Multer.File): boolean {
    if (!file?.buffer) return false;
    const mimeType = detectFileMimeType(file.buffer);
    return (
      mimeType !== undefined &&
      this.validationOptions.allowedMimeTypes.includes(mimeType)
    );
  }

  buildErrorMessage(): string {
    return "File content does not match an allowed type";
  }
}

/**
 * pipe for @UploadedFile: missing file or disallowed content → 400
 *
 * @example
 * upload(@UploadedFile(createFileValidationPipe(BUSINESS_CARD_FILE_POLICY)) file: Express.Multer.File) {}
 */
export function createFileValidationPipe(
  policy: FileUploadPolicy,
): ParseFilePipe {
  return new ParseFilePipe({
    validators: [new FileContentValidator(policy)],
  });
}
