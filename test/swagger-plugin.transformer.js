// ts-jest도 nest build와 같은 Swagger 플러그인을 거치게 함.
// 없으면 DTO 스키마가 비어, 빌드 결과물에서만 나는 문서 생성 실패를 테스트가 잡지 못함
const { before } = require("@nestjs/swagger/plugin");
const { compilerOptions } = require("../nest-cli.json");

const { options } = compilerOptions.plugins.find(
  (plugin) => plugin.name === "@nestjs/swagger",
);

module.exports = {
  name: "nestjs-swagger-plugin",
  version: 1,
  factory: (compilerInstance) => before(options, compilerInstance.program),
};
