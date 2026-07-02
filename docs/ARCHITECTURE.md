# 아키텍처

이 문서는 코드가 실제로 어떻게 동작하는지 흐름 중심으로 정리한 것입니다. 새 기능을 붙일 때 어디를 건드려야 하는지 빠르게 찾는 용도입니다.

## 프로세스 구조

Electron 표준 구조를 따릅니다. 모든 외부 API 호출(OpenAI, ElevenLabs, NewsAPI)은 **메인 프로세스**에서만 일어나고, 렌더러는 `preload.ts`가 노출한 `window.agent.*` API로만 메인과 통신합니다 (`contextIsolation: true`).

```
┌─ Main process ──────────────────────────────────────────┐
│ main.ts        창 생성, IPC 핸들러, .env/settings.json   │
│ scheduler.ts   node-schedule 브리핑 잡                    │
│ BaseAgent.ts   브리핑·회의 응답·TTS 오케스트레이션          │
│ paths.ts       쓰기 경로 (dev: 프로젝트 루트 / 패키징: userData)│
│ services/      openai · elevenlabs · news · findComplain · csv│
└──────────────┬──────────────────────────────────────────┘
               │ IPC (preload.ts의 contextBridge)
┌──────────────┴──────────────────────────────────────────┐
│ Renderer (창 3개, 모두 transparent + frameless + on-top)  │
│ bar.html       캐릭터 바 (메인 UI)                        │
│ meeting.html   회의창 (초대 화면 → 회의룸)                 │
│ settings.html  설정창                                     │
└──────────────────────────────────────────────────────────┘
```

`dock.html`과 `index.html`은 이전 버전 UI로, 현재 `main.ts`에서 로드하지 않습니다. `requirements.txt`는 Python 프로토타입 시절의 잔재입니다.

## 창(Window) 구성

| 창 | 파일 | 크기 | 생성 시점 |
|---|---|---|---|
| 바 | `bar.html` | 600×400, 화면 하단 중앙 (위치는 settings.json에 저장·복원) | 앱 시작 시 |
| 회의 | `meeting.html` | 680×640 | 바의 💬 버튼 |
| 설정 | `settings.html` | 420×600 | 바의 ⚙ 버튼 |
| 다이제스트 위젯 | `digest.html` | 400×540 | 트레이의 "Today's Digest" |

앱 시작 시 메뉴바 **트레이**(`assets/icon/tray.png`)도 생성됩니다 — 바 표시/숨김, 다이제스트 실행, 위젯·회의·설정 열기, 종료 메뉴를 제공합니다. 독 아이콘은 dev 실행에서도 `app.dock.setIcon()`으로 적용되고, 패키징 시에는 `assets/icon/agents.icns`를 사용하면 됩니다.

세 캐릭터는 별도 창이 아니라 **바 창 하나 안의 패널 3개**입니다. `main.ts`의 `windows` Map은 세 agentId 모두 같은 barWin을 가리킵니다.

## IPC 맵

`preload.ts`의 `window.agent.*` ↔ `main.ts`의 `ipcMain.handle` 1:1 대응:

| Renderer 호출 | Main 핸들러 | 역할 |
|---|---|---|
| `trigger(agentId)` | `trigger-agent` | 수동 브리핑 실행 |
| `runDigest()` | `run-digest` | 데일리 다이제스트 수동 실행 |
| `getLatestDigest()` | `get-latest-digest` | 최신 다이제스트 md 내용 (위젯용, mtime 기준) |
| `closeDigest()` | `close-digest` | 다이제스트 위젯 닫기 |
| `onBriefing(cb)` | (main → renderer `briefing` 이벤트) | 브리핑 결과 수신 |
| `meetingMessage(agentId, text)` | `meeting-message` | 대화 응답 (바 1:1 채팅과 회의 모두 사용) |
| `transcribeAudio(base64)` | `transcribe-audio` | Whisper STT |
| `greetAgent(agentId)` | `greet-agent` | 인사 TTS (캐시) |
| `getAgents()` | `get-agents` | 에이전트 메타 목록 |
| `getSettings()` / `saveSettings(data)` | `get-settings` / `save-settings` | .env + settings.json 읽기/쓰기 |
| `openMeeting/openSettings/closeMeeting/closeSettings/closeApp` | 동명 핸들러 | 창 제어 |

## 핵심 데이터 흐름

### 1. 브리핑 (스케줄 또는 수동)

```
scheduler(HH:MM 도달) 또는 trigger-agent IPC
  → BaseAgent.runBriefing()
      → news.fetchNews(keywords)           # NewsAPI, 키워드 OR 검색, 한국어 5건
      → openai.generateBriefing(prompt, news)  # gpt-4o, max_tokens 80
      → elevenlabs.textToSpeech(...)       # assets/audio/{id}_{ts}.mp3 저장
  → barWin.webContents.send("briefing", { agentId, text, audioPath })
  → bar.html: 말풍선 표시 + 오디오 재생 + 말하기 비디오 전환
```

현재 자동 스케줄러는 `main.ts`에서 `startScheduler()` 호출이 주석 처리되어 비활성 상태입니다.

### 2. 바에서 1:1 음성 대화 (호버 카드)

캐릭터에 마우스를 올리면 호버 카드가 뜨고, 🎙️ 버튼으로 VAD 기반 라이브 대화가 시작됩니다:

```
getUserMedia → AnalyserNode로 RMS 측정 (vadLoop, rAF)
  RMS > 0.012      → MediaRecorder 녹음 시작
  1.5초간 무음      → 녹음 종료 (400ms 미만 클립은 무시)
  → base64 인코딩 → transcribeAudio IPC → Whisper
  → meetingMessage IPC (에이전트별 히스토리 최대 20개 유지)
  → 응답 텍스트 표시 + TTS 오디오 재생 → 다시 Listening
```

같은 VAD 로직이 `meeting.html`에도 독립 구현으로 중복되어 있습니다 (임계값·타이밍 상수 동일).

### 3. 데일리 다이제스트 (자동 아침 회의)

`digest.ts`의 `runDailyDigest()`가 UI 없이 메인 프로세스에서 릴레이 회의를 실행합니다:

```
scheduler(schedule-digest 시각, 기본 09:00) 또는 바의 📋 버튼(run-digest IPC)
  → fetchNews(Foxy 키워드)
  → Foxy: 오늘의 문제 제기 (뉴스 기반)
  → Kitty: 해결 아이디어 제안
  → Bunny: MVP 비용 추정
  → Kitty: 첫 런칭/검증 전술
  → 각 턴이 해당 에이전트의 영속 기억(memory/conversations.json)에도 저장됨
  → summarizeDigest(): gpt-4o 영어 요약 (Today's Problem / Proposed Idea / Estimated Cost / Action Items)
  → digests/YYYY-MM-DD.md 저장 (같은 날 재실행 시 -HHMM 접미사)
  → Foxy TTS 알림 → 기존 "briefing" 채널로 바에 말풍선 + 음성 재생
```

각 턴은 `generateMeetingResponse()`를 단발 호출하는 stateless 구조라 회의창과 독립적입니다. `runDailyDigest`는 electron 의존을 optional로 처리해 plain node로도 headless 실행 가능합니다 (`node -e "require('./dist/digest').runDailyDigest()"`). 다이제스트 시각은 설정창에서 변경할 수 있고 `settings.json`의 `schedule-digest` 키로 저장됩니다.

### 4. 회의 모드

`meeting.html`은 두 화면을 가진 SPA입니다: 초대 화면(참석 에이전트 선택) → 회의룸.

- **히스토리 (영속)**: 히스토리 소유권은 메인 프로세스의 `memory.ts`에 있습니다. 렌더러는 새 메시지 텍스트만 IPC로 보내고, 메인이 `memory/conversations.json`에 에이전트별로 저장(최대 60개 보관, 최근 20개를 LLM 컨텍스트로 사용)합니다. 바 1:1 대화·회의·다이제스트가 **같은 에이전트 기억을 공유**하므로 앱을 재시작해도 이전 대화가 이어집니다. `BaseAgent`는 요청마다 새로 생성됩니다(stateless).
- **응답 라우팅**: 메시지에 이름/별칭이 포함되면 해당 에이전트만 응답, 없으면 참석 전원이 순차 응답. 별칭 테이블은 Whisper 오인식 보정용입니다 (예: "Bunny" → "Bonnie").
- **순차 발화**: for-loop로 한 에이전트씩 응답 생성 → 말풍선 + TTS 재생이 끝나야 다음 에이전트로 넘어갑니다. 릴레이 구조(Foxy가 문제 제시 → Kitty가 아이디어 전개)는 이 순차 실행 + 시스템 프롬프트로 구현됩니다.
- 마이크(VAD 라이브 모드)와 카메라(셀프뷰)도 지원합니다.

### 에이전트 도구 (근거 데이터)

- **Foxy**: 브리핑·다이제스트 시 `findComplain.ts`가 find_complain 백엔드(`localhost:8080/api/app-ideas/top`, `FIND_COMPLAIN_URL`로 변경 가능)에서 Reddit 불만 분석 결과를 가져옵니다. 3초 안에 응답이 없으면 NewsAPI로 폴백.
- **Bunny**: `csv.ts`가 `data/` 폴더의 최신 CSV를 파싱해 숫자 컬럼 통계 + 샘플 행 요약을 만들고, 회의 응답과 다이제스트 비용 추정 시 시스템 프롬프트에 `[Tool data]`로 주입됩니다.

## 패키징 (.dmg)

`npm run dist`가 electron-builder로 서명 없는 .dmg를 `release/`에 만듭니다. asar 내부는 읽기 전용이므로 쓰기 경로는 전부 `paths.ts`의 `baseDir()`를 거칩니다 — dev에서는 프로젝트 루트, 패키징 앱에서는 `~/Library/Application Support/ai-agents/` (.env, digests/, memory/, data/, assets/audio/). `assets/audio`(TTS 캐시)는 패키지에서 제외됩니다.

## 캐릭터 정의 (`config.ts`)

캐릭터는 `AGENTS` 배열의 `AgentConfig`로 선언적으로 정의됩니다 — 새 캐릭터 추가는 원칙적으로 여기에 항목을 추가하는 것으로 시작합니다. 주의할 점:

- **페르소나는 전부 시스템 프롬프트로 제어**: "인사에는 3단어 이내", "응답은 1문장", "영어만", "회의에서 Foxy가 먼저 발언" 같은 규칙이 모두 프롬프트 텍스트입니다.
- `USER_PROFILE` 환경 변수가 프롬프트에 주입되어 개인화됩니다.
- `bar.html`과 `meeting.html`에 **에이전트 id → 비디오 경로 매핑이 하드코딩**되어 있어, 캐릭터를 추가하면 renderer 쪽도 함께 수정해야 합니다. (`config.ts`의 `videoIdle`/`videoSpeak` 필드는 현재 renderer에서 사용되지 않음)

## 캐릭터 비디오 렌더링

`bar.html`은 mp4를 `<video>`로 직접 보여주지 않고, **숨긴 video를 canvas에 프레임 단위로 그리면서 어두운 픽셀(R+G+B < 60)의 알파를 0으로 만드는** 방식으로 검은 배경을 실시간 제거합니다. 평소에는 배경 제거된 PNG(`imageIdle`)를 보여주다가, 말할 때만 canvas 비디오로 전환됩니다 (`showVideo()` / `showImage()`).

## 설정 저장

두 저장소를 나눠 씁니다:

- **`.env`** (프로젝트 루트): API 키, Voice ID, USER_PROFILE — `main.ts`가 직접 파싱/병합 저장
- **`settings.json`** (Electron userData): 바 위치(barX/barY), 에이전트별 스케줄(`schedule-{agentId}`)

설정창에서 저장하면 env 키와 schedule 키를 분류해 각각 기록하고, 스케줄 변경은 즉시 `rescheduleAgent()`로 반영됩니다.

## 성능·비용 관련 장치

- **인사말 캐싱**: 앱 시작 시 3캐릭터 인사 TTS를 미리 생성 (`greetingCache`), 호버 시 즉시 재생
- **히스토리 20개 제한**: 토큰 절약 (바 1:1, 회의 동일)
- **max_tokens 80~120**: 짧은 응답 강제 (프롬프트의 "1문장" 규칙과 이중 안전장치)
- **TTS 결과 mp3가 `assets/audio/`에 누적됨** — 현재 정리 로직이 없어 주기적으로 수동 삭제 필요

## 알려진 개선 지점

- ~~회의 히스토리 비영속~~ → `memory.ts`로 해결 (에이전트별 영속 대화 기억)
- VAD 로직이 bar.html / meeting.html에 중복 → 공용 모듈로 추출 가능
- 에이전트 비디오 경로가 renderer에 하드코딩 → `get-agents` IPC로 config에서 내려주도록 통일 가능
- 개별 에이전트 자동 브리핑(`startScheduler`)은 비활성 상태 (다이제스트 스케줄만 활성)
- `/tmp/agents-debug.log`에 디버그 로그 직접 기록 (trigger-agent 핸들러)
