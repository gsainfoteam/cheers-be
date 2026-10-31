#!/usr/bin/env bash
# 고정된 버전의 tbls 를 받아 실행. 로컬과 CI 가 같은 버전을 쓰도록 이 스크립트로만 실행함
# 버전을 올릴 때는 릴리스의 checksums-{darwin,linux}.txt 에서 해시를 함께 바꾸고, scripts/tbls-templates/ 를 새 기본 템플릿과 비교한 뒤 bun run db:docs 로 문서를 다시 생성
set -euo pipefail

VERSION="v1.96.1"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="tbls_${VERSION}_darwin_arm64.zip" SHA256="99d1d53b02e06635d4d94e2823fecc78b3249e996b1785a199ba1868f9f28a8f" ;;
  Darwin-x86_64) ASSET="tbls_${VERSION}_darwin_amd64.zip" SHA256="c744731de4f96517acac234d65175eb9084968abd1a77268d75007b0443a4241" ;;
  Linux-x86_64) ASSET="tbls_${VERSION}_linux_amd64.tar.gz" SHA256="18285eef0ba7d917214e8bd7dd6a22afe5fea021eed52e7149100a3d10a2af95" ;;
  Linux-aarch64) ASSET="tbls_${VERSION}_linux_arm64.tar.gz" SHA256="f5da6e28b787ca934326870f7b69812c76e097d35a8ae612533108060f76850a" ;;
  *)
    echo "지원하지 않는 플랫폼: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

CACHE_DIR="node_modules/.cache/tbls/${VERSION}"
BIN="${CACHE_DIR}/tbls"

if [ ! -x "$BIN" ]; then
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  curl -fsSL -o "${TMP_DIR}/${ASSET}" "https://github.com/k1LoW/tbls/releases/download/${VERSION}/${ASSET}"

  if command -v sha256sum >/dev/null; then
    ACTUAL="$(sha256sum "${TMP_DIR}/${ASSET}" | cut -d ' ' -f 1)"
  else
    ACTUAL="$(shasum -a 256 "${TMP_DIR}/${ASSET}" | cut -d ' ' -f 1)"
  fi
  if [ "$ACTUAL" != "$SHA256" ]; then
    echo "${ASSET} 체크섬 불일치: ${ACTUAL}" >&2
    exit 1
  fi

  case "$ASSET" in
    *.zip) unzip -q "${TMP_DIR}/${ASSET}" tbls -d "$TMP_DIR" ;;
    *) tar -xzf "${TMP_DIR}/${ASSET}" -C "$TMP_DIR" tbls ;;
  esac

  mkdir -p "$CACHE_DIR"
  mv "${TMP_DIR}/tbls" "$BIN"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL 이 필요합니다" >&2
  exit 1
fi

# tbls 의 Postgres 드라이버는 기본으로 SSL 을 요구함
case "$DATABASE_URL" in
  *sslmode=*) TBLS_DSN="$DATABASE_URL" ;;
  *\?*) TBLS_DSN="${DATABASE_URL}&sslmode=disable" ;;
  *) TBLS_DSN="${DATABASE_URL}?sslmode=disable" ;;
esac

# TBLS_DSN 이 있으면 tbls 가 .tbls.yml 을 자동으로 읽지 않으므로 직접 지정
TBLS_DSN="$TBLS_DSN" exec "$BIN" "$@" --config .tbls.yml
