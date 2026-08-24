# CronUp Uptime-only MVP Scope Design

## 배경

작은 EC2 한 대로 운영하는 tiny project에도 외부 모니터링은 필요하지만, 기존 모니터링 아키텍처는 agent 실행 서버, 분산 조정 계층, 별도 시계열 데이터베이스 등 감시 대상과 비슷하거나 더 큰 운영 기반을 요구할 수 있다. 이 프로젝트의 제품 원칙은 “작은 프로젝트보다 무겁지 않은 모니터링”이다.

Cloudflare의 Workers, Cron Triggers, D1, Static Assets를 조합하면 별도 상시 서버 없이 외부 uptime monitor를 구성할 수 있다. Cloudflare Free plan은 작은 설치의 비용을 낮추는 중요한 기반이지만, 제품은 무료 한도나 영구적인 가격 정책을 보장하지 않는다. 핵심 가치는 특정 가격표가 아니라 사용자의 Cloudflare 계정에 배포해 중앙 모니터링 인프라의 운영 부담을 제거하는 것이다.

기존 알파 계획은 uptime 감시 외에 job heartbeat, 상태 전이 알림, Generic Webhook, 이벤트 이력, retention, 공개 demo까지 한 번에 포함했다. 각 기능은 개별적으로 타당하지만, 첫 MVP가 검증해야 할 핵심 질문인 “Cloudflare에 직접 배포한 작은 앱이 URL을 주기적으로 확인하고 현재 상태를 보여줄 수 있는가?”보다 범위가 넓다.

이번 축소의 목표는 AI-01에서 만든 Cloudflare Worker + React 기반 위에 uptime 감시의 한 줄짜리 사용자 흐름만 완성하는 것이다.

```text
관리자 인증 → URL 등록 → 자동 GET 확인 → 현재 상태 저장 → 대시보드 확인
```

## 제품 범위

MVP는 한 명의 배포 관리자가 사용하는 BYO Cloudflare 애플리케이션이다.

uptime은 광범위한 observability platform을 축소한 임시 기능이 아니라 첫 제품의 중심 기능이다. MVP는 전체 시계열 분석이나 범용 telemetry 수집 대신, HTTP(S) endpoint의 현재 가용성을 최소 운영비로 확인하는 데 집중한다.

포함한다.

- HTTP(S) URL monitor 생성, 목록 조회, 삭제
- Cloudflare Cron Trigger를 이용한 1분 주기 자동 확인
- `pending`, `healthy`, `down` 현재 상태
- 마지막 확인 시각, HTTP status code, latency 표시
- 단일 `ADMIN_SECRET`을 사용하는 HTTP Basic Auth
- React 단일 화면에서 생성, 조회, 삭제, 자동 새로고침
- D1 migration, 로컬 실행, 테스트, 배포 문서

MVP에서 제외하고 로드맵으로 이동한다.

- cron/job heartbeat와 `missed` 상태
- heartbeat token, deadline, grace 계산
- 이벤트 테이블, 이벤트 조회 API와 이벤트 상세 UI
- 상태 전이 알림과 Generic Webhook
- 7일 retention 및 cleanup
- 공개 fixture demo
- retry, incident, outbox, provider별 알림
- DNS 재검사, redirect 체인 검사, 사설·예약 IP 전체 분류 같은 고급 SSRF 정책
- 사용자·팀·세션·역할
- 관리형 SaaS control plane, 가입, 조직, 과금, 중앙 데이터 저장

첫 릴리스는 BYO 배포만 제공한다. 향후 설치가 필요 없는 managed offering을 검토할 수 있지만, 이를 위해 지금 multi-tenant 계층을 만들지는 않는다. 가능한 후속 구조는 BYO 배포의 데이터 경계를 유지한 채 별도 control plane이 설치와 업그레이드만 대행하는 형태다.

`CronUp`은 개발 중 임시 이름이다. uptime 제품의 최종 이름이 확정되면 repository 이름도 함께 변경한다. 이름 확정은 MVP 구현의 선행 조건이 아니다.

## 아키텍처

하나의 Cloudflare Worker가 Hono API와 `scheduled()` 핸들러를 제공하고 React/Vite 정적 자산을 서비스한다. D1에는 `monitors` 테이블 하나만 둔다. 별도 repository, service 계층, 이벤트 모델, notification 추상화는 만들지 않는다.

모듈 경계는 다음과 같다.

- `shared/domain.ts`: uptime monitor DTO, 상태, 입력 타입
- `worker/validation.ts`: 이름과 HTTP(S) URL의 작은 수동 검증
- `worker/auth.ts`: Basic Auth와 mutation same-origin 검사
- `worker/db/monitors.ts`: prepared SQL 기반 create/list/delete/select-due/update-result
- `worker/routes/monitors.ts`: 세 admin API
- `worker/uptime.ts`: 단일 probe와 한 tick의 bounded 실행
- `worker/index.ts`: `fetch()`와 `scheduled()` 진입점
- `src/App.tsx`: 단일 admin 화면

## 데이터 모델과 API

`monitors` 테이블은 현재 상태 표현에 필요한 값만 저장한다.

- `id`
- `name`
- `url`
- `status`: `pending | healthy | down`
- `last_checked_at`
- `last_status_code`
- `last_latency_ms`
- `created_at`
- `updated_at`

`type`, JSON config, token, deadline, event FK는 없다. 현재 uptime만 지원하므로 discriminator도 필요하지 않다.

API는 아래 세 개뿐이다.

```text
GET    /api/monitors
POST   /api/monitors
DELETE /api/monitors/:id
```

생성 body는 `{ name, url }`이다. 서버가 id, `pending` 상태와 timestamp를 만든다. 수정 API와 단일 monitor 조회 API는 만들지 않는다.

## URL 검증과 probe

입력 검증은 `URL` 파서로 처리한다.

- `http:`와 `https:`만 허용한다.
- username 또는 password가 포함된 URL은 거부한다.
- 이름은 trim 후 1~100자로 제한한다.
- body에 알 수 없는 서버 제어 필드는 받지 않는다.

MVP에서는 custom IPv4/IPv6 parser, DNS lookup, DNS rebinding 방어를 구현하지 않는다. 관리 API는 인증된 배포 소유자만 사용하고, 기본 Workers egress 제한을 전제로 한다. 더 강한 네트워크 정책은 VPC 연결이나 다중 사용자 기능을 도입할 때 함께 설계한다.

probe는 다음 규칙만 가진다.

- GET 한 번
- 고정 10초 timeout
- retry 없음
- `redirect: "manual"`로 한 번의 대상 요청만 수행
- 200~399는 `healthy`, 그 외 status/timeout/network error는 `down`
- status code와 monotonic-clock latency를 현재 monitor row에 덮어쓴다.

한 Cron tick은 가장 오래 확인되지 않은 monitor를 최대 20개 선택하고 한 bounded batch로 처리한다. 과거 tick replay는 하지 않는다. 개별 probe 실패는 해당 monitor의 `down` 결과로 기록하고, D1이나 CronUp 코드 자체 오류는 기존 상태를 유지한다.

## 인증과 UI

관리 화면 `/`과 `/api/*`는 Basic Auth로 보호한다. username은 `admin`, password는 Worker secret `ADMIN_SECRET`이다. 누락되거나 빈 secret은 fail closed 처리한다. POST/DELETE는 same-origin `Origin`을 확인한다.

React 화면은 다음만 제공한다.

- monitor 이름, URL, 현재 상태, 마지막 확인 시각/status code/latency 목록
- 이름과 URL 생성 form
- 삭제 확인
- loading, empty, error 상태
- 30초 목록 polling과 수동 retry

라우터, query library, chart, component framework는 추가하지 않는다.

## 오류 처리

API 오류는 `{ error: { code, message } }` 형태를 사용한다. 잘못된 입력은 `400`, 인증 실패는 `401`, 알 수 없는 삭제 대상은 `404`, 내부 오류는 `500`을 반환한다. probe의 target 오류는 API 오류가 아니라 monitor의 `down` 상태로 저장한다.

## 검증 전략

자동 테스트는 다음 핵심 경로만 고정한다.

- 생성 입력과 HTTP(S) URL 검증
- Basic Auth, fail-closed secret, same-origin mutation
- D1 create/list/delete, least-recently-checked 선택과 결과 update
- probe 성공, HTTP 실패, timeout/network failure, no retry, manual redirect
- tick당 20개 cap, 과거 tick replay 없음, 내부 오류 시 상태 유지
- dashboard 목록, 생성, 삭제, polling, loading/empty/error

릴리스 기준은 clean install, `npm test`, `npm run build`, 로컬 scheduled smoke와 한 번의 clean-account 배포 smoke다.

## 계획 문서 재구성

기존 AI-02~15는 아래 AI-02~10으로 축소한다.

1. AI-02 uptime domain과 입력 검증
2. AI-03 D1 monitors schema와 query
3. AI-04 Basic Auth와 공통 오류
4. AI-05 monitor create/list/delete API
5. AI-06 단일 uptime probe
6. AI-07 scheduled bounded runner
7. AI-08 admin dashboard
8. AI-09 배포 문서와 라이선스
9. AI-10 MVP release verification

상세 AI-02 계획과 마스터 구현 계획은 이 순서와 범위로 다시 작성한다. 원본 제품 스펙도 같은 uptime-only 경계를 반영해 job, events, webhook, demo 약속을 로드맵으로 옮긴다.

## 완료 기준

MVP는 배포 관리자가 인증 후 URL을 등록하고, Cron Trigger가 URL을 주기적으로 확인하며, 현재 상태를 대시보드에서 확인하고 monitor를 삭제할 수 있을 때 완료다. 이 흐름에 직접 참여하지 않는 저장·알림·데모 기능은 완료 조건에 포함하지 않는다.

제품 가설은 이 사용자 흐름이 별도 VM, agent fleet, 분산 coordination service, 전용 시계열 데이터베이스 없이 하나의 Cloudflare 배포로 동작할 때 검증된다. 관리형 SaaS와 최종 제품명은 별도의 후속 결정이다.
