# PlantUML 공식 이미지에는 한글 폰트가 없어 PNG 렌더링 시 한글이 깨진다.
# Noto Sans CJK(KR 포함)를 설치한 이미지를 만든다. 사용법은 README.md 참고.
FROM plantuml/plantuml:latest
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f
