# 📋 One App — 사내 도구 통합 허브 (기획서 / 로드맵)

> 스크린샷 같은 **워크스페이스형 데스크톱 앱**. 하나의 창 안에서 사이드바로
> 터미널·VPN·API·웹 대시보드 등 모든 사내 도구를 관리한다.

## 1. 개요

| 항목 | 내용 |
|------|------|
| **형태** | 창(window) 기반 워크스페이스 앱 (사이드바 + 탭 + 메인 영역) |
| **기술 스택** | **Electron + React + TypeScript** |
| **빌드/패키징** | Electron Forge + Vite (공식 권장) |
| **런타임** | Node.js v22, Electron 43 |
| **VPN 방식** | 기존 VPN 클라이언트 실행·제어 (앱 내장 X) |

## 2. 앱 구조

```
┌──────┬────────────────────────────────────────┐
│ 사이드 │  [탭] [탭] [탭] ...                       │
│ 바    ├────────────────────────────────────────┤
│(섹션) │        메인 영역                          │
│      │   (터미널 / 웹 대시보드 / 각종 패널)         │
└──────┴────────────────────────────────────────┘
```

## 3. 개발 단계 (Phase)

- [x] **Phase 0 · 스캐폴딩** — Electron Forge + Vite + React + TS 프로젝트 생성, 실행 확인
- [~] **Phase 1 · 앱 셸 레이아웃** — 사이드바 + 탭바 + 메인 영역 (현재: 자리표시자 상태)
- [ ] **Phase 2 · 내장 터미널** — xterm.js + node-pty (스크린샷의 핵심 기능)
- [ ] **Phase 3 · 도구/액션 패널** — 앱 실행 / `.command`·스크립트 실행 / API 호출 / VPN
- [ ] **Phase 4 · 웹 대시보드 임베드** — Jira·Docker·NAS 등 webview 탭
- [ ] **Phase 5 · 설정·영속화·상태관리** — 섹션/액션 편집, 설정 저장
- [ ] **Phase 6 · 패키징/배포** — `.dmg`, 코드서명/공증 (동료 배포 시)

## 4. 확정된 세부사항
- **VPN**: 기존 클라이언트 실행/제어만 (앱 내장 X)
- **일정등록 커맨드**: `.command` 파일 → 자식 프로세스로 실행
- **개발 순서**: 터미널(Phase 2)을 웹 대시보드보다 우선

## 5. 주요 명령어
```bash
npm start     # 개발 모드 실행 (핫리로드)
npm run make  # 배포용 .app/.dmg 패키징
npm run lint  # 린트
```

## 6. 미확정 / 추후 확인
- 회사 VPN 제품명 (Cisco AnyConnect / GlobalProtect / OpenVPN 등)
- 연동할 웹 대시보드 목록 및 URL (Jira/Jenkins/Docker/NAS 등)
- 프로젝트별 API 엔드포인트

## 7. 알아둘 점 (트러블슈팅)
- 설치 중 `ETARGET No matching version`(예: `@types/estree@1.0.9`) 오류는 **npm 캐시 손상**이 원인.
  → `npm cache clean --force` 후 재설치로 해결됨.
- `package.json`의 `overrides`로 `@types/estree`를 1.0.8로 고정해 둠.

## 8. 프로젝트 구조

```
src/
├── main/                    🖥️ 메인 프로세스 (Node)
│   ├── main.ts              · 진입점: 창 생성 + IPC 등록
│   └── ipc/                 · 기능별 IPC 핸들러
│       └── schedule.ts
├── preload/
│   └── preload.ts           · contextBridge (window.oneApp)
├── renderer/                🎨 렌더러 (React UI)
│   ├── renderer.tsx         · React 마운트 진입점
│   ├── App.tsx              · 앱 셸(사이드바/탭/메인)
│   ├── components/          · 공용 UI (Sidebar 등)
│   ├── features/            · 기능별 폴더
│   │   └── schedule/        ·   일정 등록 (ScheduleSection.tsx)
│   ├── styles/
│   └── global.d.ts          · window.oneApp 타입
└── shared/
    └── types.ts             · 프로세스 공용 타입
```

> ⚠️ `main.ts`·`preload.ts`·`renderer.tsx` 파일 **이름**이 빌드 산출물 이름이 되므로 바꾸지 말 것.

### 새 기능(섹션) 추가 방법
1. `src/renderer/features/<기능>/<기능>Section.tsx` 컴포넌트 작성
2. `src/renderer/App.tsx`의 `SECTIONS`에 항목 추가 + 메인 영역 분기 추가
3. (네이티브/파일/프로세스 작업이 필요하면) `src/main/ipc/<기능>.ts`에 IPC 핸들러 작성
   → `main.ts`에서 `register...Ipc()` 호출, `preload.ts`에 API 노출, `shared/types.ts`에 타입 추가
