import { CSSProperties, useState } from "react";
import catCheers3d from "../assets/badge/cat-cheers-3d-128.webp";
import catShadow from "../assets/badge/cat-cheers-shadow.svg";
import catCheers from "../assets/badge/cat-cheers.svg";
import signatureRibbon from "../assets/badge/signature-ribbon.svg";

/*
 * 현업자 화면의 사원증 미리보기 (CRB-89, docs/sequence/flow/admin-company-logo-preview.puml).
 *
 * 마크업 · 수치는 cheers-fe `src/components/employee-badge.tsx`(EmployeeBadge)와
 * `brand-cat.tsx`(BrandCat)를 Tailwind 없이 옮긴 것이고, 값은 `employee-badge-data.ts`
 * (badgeDataOf · hashtagText)와 같은 규칙으로 만든다. 프론트엔드 카드가 바뀌면 같이 고친다.
 * 글꼴은 불러오지 않으므로 시스템 한글 글꼴로 그려진다.
 */

/** 시안의 모바일 카드 폭. `--u`(시안 1px)의 기준 */
const BASE_WIDTH = 170.5;

/** 현업자 목록에서 사원증이 그려지는 폭: 모바일 2열, 데스크톱 4열 */
const PREVIEW_WIDTHS = [
  { label: "모바일 목록", width: BASE_WIDTH },
  { label: "데스크톱 목록", width: 288 },
];

/** 회사 이름 · 로고만 실제 값이고 나머지는 고정 더미 현업자 */
const DUMMY_GRADUATED = {
  department: "플랫폼개발팀",
  nickname: "미리보기선배",
  job: "백엔드\n개발자",
  hashtags: ["전기전자", "3년차"],
};

type BadgeData = {
  /** null이면 로고 없음 → 고양이 */
  companyLogo: string | null;
  company: string;
  department: string | null;
  nickname: string;
  role: string;
  meta: string;
};

// cheers-fe hashtagText: 저장된 값에는 #이 없지만 있어도 두 번 붙이지 않음
const hashtagText = (tags: string[], separator = " ") =>
  tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(separator);

type Props = {
  company: { name: string; logo_url: string | null };
  onClose: () => void;
};

export function CompanyBadgePreview({ company, onClose }: Props) {
  const [logoFailed, setLogoFailed] = useState(false);

  // cheers-fe badgeDataOf와 같은 규칙. 사원증 안에서는 꼬리표 사이를 두 칸 띄움
  const data: BadgeData = {
    companyLogo: company.logo_url,
    company: company.name,
    department: DUMMY_GRADUATED.department,
    nickname: DUMMY_GRADUATED.nickname,
    role: DUMMY_GRADUATED.job,
    meta: hashtagText(DUMMY_GRADUATED.hashtags, "  "),
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-badge-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="company-badge-preview-title">{company.name} 사원증 미리보기</h3>
        <p className="placeholder">
          현업자 화면의 사원증과 같은 모양입니다. 회사 이름과 로고만 실제 값이고
          부서 · 닉네임 · 직무 · 해시태그는 예시입니다.
          {!company.logo_url &&
            " 로고가 없는 회사는 현업자 화면에서도 고양이로 보입니다."}
        </p>
        {logoFailed && (
          <p className="error-text" role="status">
            로고를 불러오지 못해 현업자 화면과 같이 고양이로 표시했습니다.
            링크가 만료되었을 수 있으니 목록을 새로고침해 보세요.
          </p>
        )}
        <div className="badge-preview-list">
          {PREVIEW_WIDTHS.map(({ label, width }) => (
            <figure key={label} className="badge-preview-item">
              <div style={{ width }}>
                <EmployeeBadge
                  data={data}
                  onLogoError={() => setLogoFailed(true)}
                />
              </div>
              <figcaption className="placeholder">
                {label} ({width}px)
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// cheers-fe EmployeeBadge. 카드는 폭에 따라 통째로 확대되고(--u), 글자만 카드 폭 220px 기준 두 벌
function EmployeeBadge({
  data,
  onLogoError,
}: {
  data: BadgeData;
  onLogoError: () => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = logoFailed ? null : data.companyLogo;

  return (
    <div className="employee-badge-container">
      <article
        className="employee-badge"
        style={{ "--u": `calc(100cqw / ${BASE_WIDTH})` } as CSSProperties}
      >
        <div className="employee-badge-company">
          <img
            src={logo ?? catCheers}
            alt=""
            decoding="async"
            onError={
              logo
                ? () => {
                    setLogoFailed(true);
                    onLogoError();
                  }
                : undefined
            }
            className={
              logo
                ? "employee-badge-logo"
                : "employee-badge-logo employee-badge-logo-cat"
            }
          />
          <div className="employee-badge-company-text">
            <p className="employee-badge-company-name">{data.company}</p>
            {data.department ? (
              <p className="employee-badge-department">{data.department}</p>
            ) : null}
          </div>
        </div>

        <div className="employee-badge-identity">
          <p className="employee-badge-name">{data.nickname}</p>
          <p className="employee-badge-role">{data.role}</p>
          <p className="employee-badge-meta">{data.meta}</p>
        </div>

        <div className="employee-badge-ribbon">
          <img
            src={signatureRibbon}
            alt=""
            aria-hidden
            className="employee-badge-ribbon-image"
          />
          <p className="employee-badge-wordmark">cheers!</p>
          <p className="employee-badge-micro">GIST ALUMNI</p>
          <span aria-hidden className="brand-cat employee-badge-seal">
            <span className="brand-cat-shadow">
              <span className="brand-cat-shadow-inset">
                <img src={catShadow} alt="" />
              </span>
            </span>
            <img
              src={catCheers3d}
              alt=""
              decoding="async"
              className="brand-cat-image"
            />
          </span>
        </div>

        {/* 목걸이 줄이 지나가는 구멍 */}
        <div className="employee-badge-slot" />
      </article>
    </div>
  );
}
