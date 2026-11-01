import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminInterestRepository,
  AdminInterestRow,
} from "@src/admin-repository/admin-interest.repository";
import { DatabaseService } from "@src/database/database.service";
import {
  AdminInterestDto,
  AdminInterestNameRequestDto,
  ReorderAdminInterestRequestDto,
} from "@src/manager/interest/dto/admin-interest.dto";
import { InterestService } from "@src/student/interest.service";

const DUPLICATE_NAME = "This interest name already exists.";
const NOT_FOUND = "Interest not found.";

// 이름을 바꾸거나 지워도 student_profile.interests(문자열 복사본)는 건드리지 않음.
// 쓰기가 커밋된 뒤 이 인스턴스의 캐시를 다시 읽음. 다른 인스턴스는 InterestService의 주기 재조회로 반영
@Injectable()
export class AdminInterestService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly adminInterestRepository: AdminInterestRepository,
    private readonly interestService: InterestService,
  ) {}

  async list(): Promise<AdminInterestDto[]> {
    const rows = await this.adminInterestRepository.findAll();
    return rows.map((row) => this.toDto(row));
  }

  async create(req: AdminInterestNameRequestDto): Promise<AdminInterestDto> {
    const row = await this.dbService.db.transaction(async (tx) => {
      await this.adminInterestRepository.lockForWrite(tx);
      const existing = await this.adminInterestRepository.findByName(
        req.name,
        tx,
      );
      if (existing) {
        throw new ConflictException(DUPLICATE_NAME);
      }
      return this.adminInterestRepository.insert(req.name, tx);
    });

    await this.interestService.refresh();
    return this.toDto(row);
  }

  async updateName(
    pk: number,
    req: AdminInterestNameRequestDto,
  ): Promise<AdminInterestDto> {
    const row = await this.dbService.db.transaction(async (tx) => {
      await this.adminInterestRepository.lockForWrite(tx);
      const target = await this.adminInterestRepository.findByPk(pk, tx);
      if (!target) {
        throw new NotFoundException(NOT_FOUND);
      }
      const existing = await this.adminInterestRepository.findByName(
        req.name,
        tx,
      );
      if (existing && existing.pk !== pk) {
        throw new ConflictException(DUPLICATE_NAME);
      }
      return this.adminInterestRepository.updateName(pk, req.name, tx);
    });

    await this.interestService.refresh();
    return this.toDto(row);
  }

  async remove(pk: number): Promise<void> {
    const deleted = await this.adminInterestRepository.deleteByPk(pk);
    if (!deleted) {
      throw new NotFoundException(NOT_FOUND);
    }

    await this.interestService.refresh();
  }

  async reorder(
    req: ReorderAdminInterestRequestDto,
  ): Promise<AdminInterestDto[]> {
    const rows = await this.dbService.db.transaction(async (tx) => {
      await this.adminInterestRepository.lockForWrite(tx);
      const current = await this.adminInterestRepository.findAll(tx);
      // pks에 중복이 없으므로 (DTO에서 검사) 개수가 같고 모두 현재 목록에 있으면 같은 집합
      const currentPks = new Set(current.map((row) => row.pk));
      if (
        req.pks.length !== current.length ||
        !req.pks.every((pk) => currentPks.has(pk))
      ) {
        throw new ConflictException(
          "The interest list has changed. Reload and try again.",
        );
      }

      for (const [index, pk] of req.pks.entries()) {
        await this.adminInterestRepository.updateSortOrder(pk, index + 1, tx);
      }
      return this.adminInterestRepository.findAll(tx);
    });

    await this.interestService.refresh();
    return rows.map((row) => this.toDto(row));
  }

  private toDto(row: AdminInterestRow): AdminInterestDto {
    return { pk: row.pk, name: row.name, sort_order: row.sortOrder };
  }
}
