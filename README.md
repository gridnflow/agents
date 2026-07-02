# AI Agents — 맥 데스크탑 AI 에이전트 캐릭터

macOS 데스크탑 위에 항상 떠 있는 AI 캐릭터 바입니다. 여우·고양이·토끼 세 캐릭터가 각자의 역할(뉴스 앵커, 아이디어 플래너, 예산 분석가)을 가지고 음성으로 브리핑하고, 회의 모드에서는 사용자와 함께 릴레이 토론을 합니다.

![screenshot](ui/Gemini_Image.png)

## 캐릭터

| 캐릭터 | 이름 | 역할 | 기본 브리핑 시간 |
|---|---|---|---|
| 🦊 여우 | **Foxy** | 뉴스 앵커 — 인터넷/뉴스에서 사람들의 불만·문제·미충족 니즈를 헌팅 | 09:00 |
| 🐱 고양이 | **Kitty** | 아이디어 플래너 — Foxy가 찾은 문제를 실행 가능한 아이디어·전략으로 전개 | 11:00 |
| 🐰 토끼 | **Bunny** | 예산 분석가 — API·SaaS·인프라 비용을 숫자로 분석 | 14:00 |

회의 모드에서는 인사 후 Foxy가 먼저 문제를 던지고 → Kitty가 아이디어로 받는 릴레이 구조로 설계되어 있습니다.

## 주요 기능

- **데스크탑 바**: 투명·프레임리스·항상 위(always-on-top) 창에 캐릭터 비디오가 떠 있고, 드래그로 위치 이동(위치는 자동 저장·복원)
- **데일리 다이제스트 (자동 아침 회의)**: 매일 설정 시각(기본 09:00)에 에이전트들끼리 자동 릴레이 회의(Foxy 문제 제기 → Kitty 아이디어 → Bunny 비용 → Kitty 런칭 전술)를 열고, 결과를 `digests/YYYY-MM-DD.md`에 요약 + 회의록(영어)으로 저장. 완료되면 Foxy가 음성으로 알려줍니다. 바의 📋 버튼으로 수동 실행도 가능
- **음성 브리핑**: NewsAPI로 키워드 뉴스 수집 → OpenAI(gpt-4o)로 요약 → ElevenLabs TTS로 캐릭터별 목소리 재생
- **회의(Meeting) 모드**: 3캐릭터 그룹 채팅. 대화 히스토리를 유지하며 각 에이전트가 페르소나에 맞게 응답
- **영속 대화 기억**: 모든 대화(바 1:1, 회의, 다이제스트)가 `memory/conversations.json`에 에이전트별로 저장되어 앱을 껐다 켜도 이어집니다 — "어제 그 아이디어 어떻게 됐지?"가 가능
- **음성 입력**: 마이크 녹음 → OpenAI Whisper STT로 텍스트 변환
- **스케줄러**: node-schedule 기반, 캐릭터별 브리핑 시간을 설정창에서 변경 가능 (현재 자동 브리핑은 `main.ts`에서 비활성화 상태)
- **인사말 캐싱**: 앱 시작 시 각 캐릭터의 인사 음성을 미리 생성해 호버 시 즉시 재생
- **설정창**: API 키, 캐릭터별 Voice ID, 스케줄, 사용자 프로필을 GUI에서 편집 (`.env` + `settings.json`에 저장)
- **메뉴바 위젯 + 앱 아이콘**: 메뉴바 트레이에서 바 표시/숨김, 다이제스트 실행, 회의·설정 열기 가능. "Today's Digest" 위젯 창으로 최신 다이제스트를 바로 확인. 캐릭터 3인방 앱 아이콘(`assets/icon/agents.icns`)이 독에 표시됩니다

## 기술 스택

- **Electron 28** + **TypeScript** — 데스크탑 앱
- **OpenAI** — gpt-4o (대화·브리핑), whisper-1 (STT)
- **ElevenLabs** — 캐릭터별 TTS 음성
- **NewsAPI** — 브리핑용 뉴스 수집
- **node-schedule** — 브리핑 스케줄러

## 시작하기

### 1. 설치

```bash
npm install
```

### 2. 환경 변수

프로젝트 루트에 `.env` 파일을 만듭니다 (설정창에서 GUI로 입력해도 됩니다):

```env
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
NEWS_API_KEY=...

# ElevenLabs에서 생성한 캐릭터별 Voice ID
VOICE_FOX=...
VOICE_CAT=...
VOICE_RABBIT=...

# (선택) 에이전트에게 전달할 사용자 소개
USER_PROFILE=...
```

### 3. 실행

```bash
npm run dev
```

`dev.sh`가 TypeScript watch 컴파일과 Electron을 함께 띄웁니다. 빌드만 하려면 `npm run build`, 빌드된 결과 실행은 `npm start`.

### 4. 배포용 .dmg 빌드

```bash
npm run dist   # → release/AI Agents-<버전>-arm64.dmg
```

패키징된 앱은 `.env`·다이제스트·대화 기억·오디오를 `~/Library/Application Support/ai-agents/`에 저장합니다 (API 키는 설정창에서 입력).

### Bunny에게 데이터 주기

`data/` 폴더에 CSV(가계부, 지출 내역 등)를 넣으면 Bunny가 최신 파일의 통계를 근거로 답합니다.

### Foxy에게 실데이터 주기

find_complain 백엔드(`localhost:8080`)를 켜두면 Foxy가 Reddit 불만 분석 결과로 브리핑합니다. 꺼져 있으면 NewsAPI로 자동 폴백합니다. 주소는 `FIND_COMPLAIN_URL` 환경 변수로 변경 가능.

## 프로젝트 구조

```
agents/
├── src/
│   ├── main.ts            # Electron 메인 프로세스 — 창 관리, IPC 핸들러, 설정 저장
│   ├── config.ts          # 에이전트 정의 (페르소나, 시스템 프롬프트, 키워드, 스케줄)
│   ├── scheduler.ts       # node-schedule 기반 브리핑·다이제스트 스케줄러
│   ├── digest.ts          # 자동 아침 회의 → 데일리 다이제스트 (digests/*.md)
│   ├── memory.ts          # 에이전트별 영속 대화 기억 (memory/conversations.json)
│   ├── preload.ts         # 렌더러 ↔ 메인 IPC 브리지
│   ├── agents/
│   │   └── BaseAgent.ts   # 브리핑 / 회의 응답 / TTS 공통 로직
│   ├── services/
│   │   ├── openai.ts      # gpt-4o 대화·브리핑, Whisper STT
│   │   ├── elevenlabs.ts  # TTS
│   │   └── news.ts        # NewsAPI 뉴스 수집
│   └── renderer/
│       ├── bar.html       # 데스크탑 캐릭터 바
│       ├── meeting.html   # 3-에이전트 회의창
│       ├── digest.html    # 오늘의 다이제스트 위젯
│       └── settings.html  # 설정창
├── assets/
│   ├── images/            # 캐릭터 이미지·비디오
│   ├── videos/            # 말하기 애니메이션 (webm)
│   ├── icon/              # 앱 아이콘 (.icns, 독/트레이 PNG)
│   └── audio/             # 생성된 TTS mp3 캐시
└── dev.sh                 # tsc watch + electron 실행 스크립트
```

동작 원리(창 구조, IPC 맵, 브리핑·회의·음성 대화 흐름)는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에, 예상 API 사용료는 [docs/COSTS.md](docs/COSTS.md)에 정리되어 있습니다.

## 로드맵

- [x] **자동 아침 회의 → 데일리 다이제스트**: 스케줄러와 회의 모드를 묶어 매일 아침 에이전트들끼리 자동 회의를 돌리고 결과를 마크다운 일지로 저장
- [x] **find_complain 연동**: Foxy가 Reddit 불만 수집·분석 백엔드(find_complain)의 실데이터를 받아 브리핑 — `localhost:8080` 백엔드가 켜져 있으면 자동 사용, 꺼져 있으면 NewsAPI 폴백
- [x] **에이전트 도구 부여**: Bunny가 `data/` 폴더의 최신 CSV(가계부/지출 내역)를 읽어 실제 숫자로 답변 (Foxy는 find_complain + NewsAPI)
- [x] **대화 기억 영속화**: 회의 히스토리를 파일로 저장해 세션 간 연속성 확보
- [x] **배포**: electron-builder .dmg 패키징 (`npm run dist` → `release/AI Agents-*.dmg`)
- [ ] 로그인 시 자동 시작, 글로벌 단축키(푸시투토크)
