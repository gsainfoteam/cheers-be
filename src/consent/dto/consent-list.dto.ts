export class ConsentDto {
  type: string;
  version: string;
  is_required: boolean;
  url: string;
  agreed: boolean;
}

export class ConsentListResponseDto {
  consents: ConsentDto[];
}
