import { BadRequestException, NestInterceptor, Type } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { FileUploadPolicy } from "./file.constants";

/**
 * single file upload interceptor with size / MIME type limits
 * - exceeding maxSize: 413 (multer LIMIT_FILE_SIZE, converted by Nest)
 * - disallowed MIME type: 400
 * - missing file: use `@UploadedFile(new ParseFilePipe())` in the controller (400)
 *
 * @example
 * @UseInterceptors(createFileUploadInterceptor("file", BUSINESS_CARD_FILE_POLICY))
 * upload(@UploadedFile(new ParseFilePipe()) file: Express.Multer.File) {}
 */
export function createFileUploadInterceptor(
  fieldName: string,
  policy: FileUploadPolicy,
): Type<NestInterceptor> {
  return FileInterceptor(fieldName, {
    limits: { fileSize: policy.maxSize, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!policy.allowedMimeTypes.includes(file.mimetype)) {
        return callback(
          new BadRequestException(`Unsupported file type: ${file.mimetype}`),
          false,
        );
      }
      callback(null, true);
    },
  });
}
