# Omnixa

<p align="center">오픈 소스 AI 코딩 에이전트.</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

---

### 설치

이 저장소에서 로컬로 빌드한 CLI 바이너리를 설치하세요:

```bash
./install --binary /absolute/path/to/omnixa
"$HOME/.omnixa/bin/omnixa" --version
```

설치 디렉터리는 `$HOME/.omnixa/bin`입니다. 원격 설치와 CLI 자동 업데이트에는 유효한 `OMNIXA_UPDATE_URL` 설정이 필요합니다.

### 데스크톱 앱

데스크톱 릴리스 대상: [keerzzz/Omnixa](https://github.com/keerzzz/Omnixa/releases).

동일한 소스에서 로컬 빌드 및 패키징: [packages/desktop/README.md](packages/desktop/README.md).

### Agents

Omnixa 에는 내장 에이전트 2개가 있으며 `Tab` 키로 전환할 수 있습니다.

- **build** - 기본값, 개발 작업을 위한 전체 권한 에이전트
- **plan** - 분석 및 코드 탐색을 위한 읽기 전용 에이전트
  - 기본적으로 파일 편집을 거부
  - bash 명령 실행 전에 권한을 요청
  - 낯선 코드베이스를 탐색하거나 변경을 계획할 때 적합

또한 복잡한 검색과 여러 단계 작업을 위한 **general** 서브 에이전트가 포함되어 있습니다.
내부적으로 사용되며, 메시지에서 `@general` 로 호출할 수 있습니다.

[agents](packages/core/README.md) 에 대해 더 알아보세요.

### 문서

Omnixa 설정에 대한 자세한 내용은 [**문서**](specs/v2/README.md) 를 참고하세요.

### 기여하기

Omnixa 에 기여하고 싶다면, Pull Request 를 제출하기 전에 [contributing docs](./CONTRIBUTING.md) 를 읽어주세요.

### Omnixa 기반으로 만들기

Omnixa 와 관련된 프로젝트를 진행하면서 이름에 "omnixa"(예: "omnixa-dashboard" 또는 "omnixa-mobile") 를 포함한다면, README 에 해당 프로젝트가 Omnixa 팀이 만든 것이 아니며 어떤 방식으로도 우리와 제휴되어 있지 않다는 점을 명시해 주세요.

---

Based on [OpenCode](https://github.com/anomalyco/opencode), under the [MIT license](LICENSE).
