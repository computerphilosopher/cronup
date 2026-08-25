# CronUp Uptime Alpha Specification

## 1. Product purpose

작은 EC2 한 대로 운영하는 tiny project에도 외부 모니터링은 필요하다. 그러나 전통적인 모니터링 제품은 agent 실행 서버, 분산 조정 계층, 별도 시계열 저장소처럼 감시 대상에 버금가는 인프라와 운영비를 요구할 수 있다. 이 프로젝트는 작은 프로젝트의 모니터링이 프로젝트 자체보다 무거워서는 안 된다는 문제의식에서 출발한다.

CronUp은 사용자의 Cloudflare 계정에 직접 배포하는 단일 관리자용 uptime monitor다. Cloudflare Workers, Cron Triggers, D1, Static Assets를 함께 사용해 별도 상시 서버와 시계열 데이터베이스 없이 HTTP(S) endpoint의 현재 상태를 확인한다. Cloudflare Free plan에서 작은 배포를 운영할 수 있는 비용 구조를 지향하지만, 특정 사용량의 무료 운영을 보장하지는 않는다.

이번 MVP가 검증하는 질문은 하나다.

> 작은 프로젝트의 관리자가 별도 모니터링 서버를 운영하지 않고 몇 번의 클릭으로 설치해 URL을 등록하고, 확인된 장애와 복구를 Slack으로 받을 수 있는가?

Cron job heartbeat, Slack 이외의 알림 채널, 이벤트 분석, 공개 demo는 이번 릴리스의 제품 약속이 아니다. 이 문서에서 명시한 기능 외에는 MVP 기능으로 간주하지 않는다.

`CronUp`은 개발 중 사용하는 임시 제품명이다. uptime-only 제품에 맞는 이름은 MVP 방향이 검증된 뒤 결정하며, 제품명이 확정될 때 repository 이름도 함께 변경한다.

## 2. Stack and deployment boundary

제품은 다음 다섯 기술만 사용한다.

1. TypeScript
2. Cloudflare Workers
3. Hono
4. Cloudflare D1 raw SQL
5. React + Vite

Cloudflare Cron Trigger와 Static Assets는 플랫폼 기능이다. runtime dependency는 `hono`, `react`, `react-dom`만 사용한다. ORM, query library, router, Queue, Durable Objects, KV, R2, Redis와 외부 DB는 사용하지 않는다. Slack Incoming Webhook만 외부 notification endpoint로 사용한다.

배포 단위는 Worker 하나다. Worker는 `fetch()`로 API와 React 자산을 제공하고, `scheduled()`로 uptime tick을 처리한다. 제품은 BYO Cloudflare, 단일 관리자, best-effort 환경이며 SaaS 용량·실행 시각·가용성 SLA를 약속하지 않는다.

첫 제품은 BYO Cloudflare 배포를 중심으로 한다. 사용자·조직·과금·중앙 control plane을 미리 만들지 않으며 monitor 데이터와 secret은 배포 소유자의 Cloudflare 계정 안에 둔다. 향후 관리형 배포를 제공할 가능성은 열어 두되, MVP 아키텍처와 완료 조건은 관리형 SaaS를 전제로 하지 않는다.

## 3. Monitor model

```ts
type MonitorStatus = "pending" | "healthy" | "down";

type CreateMonitorRequest = {
  name: string;
  url: string;
  failureThreshold?: number;
};

type MonitorDto = {
  id: string;
  name: string;
  url: string;
  status: MonitorStatus;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number | null;
  statusCode: number | null;
  latencyMs: number | null;
  failureThreshold: number;
  consecutiveFailures: number;
};
```

모든 시간은 UTC epoch milliseconds다. 외부 입력은 작은 수동 함수로 검증한다. `failureThreshold`는 생략 시 `2`이며 `1..5` 범위의 정수만 허용한다. `consecutiveFailures`는 서버만 갱신한다. monitor type discriminator, heartbeat token, deadline, event DTO는 없다.

## 4. Uptime checks

- 생성 시 monitor는 `pending`이다.
- Cloudflare Cron Trigger가 1분마다 한 번 실행한다.
- 가장 오래 확인되지 않은 monitor를 최대 20개 선택한다.
- 각 monitor는 HTTP `GET` 한 번만 보낸다.
- timeout은 10초이며 retry는 하지 않는다.
- 요청은 `redirect: "manual"`로 보낸다. redirect 대상에 추가 요청을 하지 않는다.
- HTTP status 200~399는 성공 probe, 그 밖의 status·timeout·DNS 오류·network 오류는 실패 probe다.
- 실패 probe는 `consecutiveFailures`를 하나 증가시킨다. monitor별 `failureThreshold`에 도달하기 전에는 기존 `pending` 또는 `healthy` 상태를 유지하고, 도달하면 `down`으로 전환한다.
- 성공 probe는 `consecutiveFailures`를 `0`으로 초기화하고 즉시 `healthy`로 만든다. 이전 상태가 `down`이면 recovery 전이다.
- 성공/실패 결과는 monitor row의 status, `last_checked_at`, `status_code`, `latency_ms`, `consecutive_failures`를 갱신한다.
- uptime check가 성공하면 하나의 결과만 저장한다. 과거에 지연된 Cron tick을 재생하지 않는다.
- CronUp 자체의 D1 또는 코드 오류가 발생하면 해당 monitor의 기존 상태를 보존한다.

latency는 probe 시작과 종료의 monotonic clock 차이로 계산하며 epoch 시각으로 대체하지 않는다.

## 5. Slack notifications

- Slack Incoming Webhook은 MVP의 유일한 notification channel이다.
- 설치 전체가 Worker secret `SLACK_WEBHOOK_URL` 하나를 사용한다. secret이 없거나 비어 있어도 uptime probe와 상태 저장은 계속 동작한다.
- `pending | healthy`에서 `down`으로 전환될 때 장애 알림을 보낸다.
- `down`에서 `healthy`로 전환될 때 복구 알림을 보낸다.
- 같은 상태가 지속될 때는 중복 알림을 보내지 않는다.
- 한 scheduled tick에서 여러 상태 전이가 발생하면 Slack 메시지 하나로 묶는다.
- 전송은 첫 시도를 포함해 최대 3회다. `429`와 `500..599`만 재시도한다. `429`는 유효한 `Retry-After`를 최대 30초 범위에서 우선 적용하고, `5xx`는 1초 후 재시도한다.
- 그 밖의 `4xx`와 network/configuration 오류는 재시도하지 않는다. 최종 실패는 webhook URL을 제외한 구조화된 로그로 남긴다.
- Slack 실패는 저장된 monitor 상태를 되돌리지 않는다. D1 outbox, 다음 tick replay와 delivery guarantee는 없다.
- Basic Auth와 same-origin으로 보호되는 `POST /api/notifications/slack/test`가 테스트 메시지를 보낸다.

## 6. URL and request validation

생성 API는 `{ name, url, failureThreshold? }` 외의 필드를 받지 않는다.

- 이름은 trim 후 1~100자다.
- URL은 `http:` 또는 `https:`만 허용한다.
- URL의 username/password는 거부한다.
- malformed URL과 빈 문자열은 거부한다.
- `failureThreshold`는 생략하거나 `1..5` 범위의 정수여야 한다.
- custom IPv4/IPv6 parser와 DNS lookup은 MVP에 포함하지 않는다.
- redirect 체인과 DNS rebinding 검사는 uptime probe의 후속 보안 작업으로 남긴다.

관리 API는 Basic Auth로 보호되고, 기본 Workers egress 정책을 전제로 한다. 이 문서는 URL 검증을 완전한 SSRF 방어라고 주장하지 않는다.

## 7. Persistence

D1에는 `monitors` 테이블 하나만 만든다.

필드:

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `url TEXT NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('pending', 'healthy', 'down'))`
- `last_checked_at INTEGER`
- `last_status_code INTEGER`
- `last_latency_ms INTEGER`
- `failure_threshold INTEGER NOT NULL DEFAULT 2`
- `consecutive_failures INTEGER NOT NULL DEFAULT 0`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

필수 query는 create, list, delete, least-recently-checked selection, probe/result update다. 모든 외부 값은 prepared statement bind로 전달한다. 이벤트와 notification outbox 테이블, FK cascade, retention index, batch event insert는 없다.

## 8. Authentication and API

관리 화면 `/`과 아래 admin API는 HTTP Basic Auth가 필요하다.

```text
GET    /api/monitors
POST   /api/monitors
DELETE /api/monitors/:id
POST   /api/notifications/slack/test
```

- username은 고정 `admin`이다.
- password는 Worker secret `ADMIN_SECRET`이다.
- secret이 없거나 비어 있으면 fail closed하고 항상 `401` challenge를 반환한다.
- 실패 응답은 `WWW-Authenticate: Basic realm="CronUp"`를 포함한다.
- POST/DELETE는 JSON이 필요한 경우 `application/json`과 same-origin `Origin`을 검사한다.
- 삭제는 `204`를 반환한다. 존재하지 않는 id는 일관된 `404` 오류를 반환한다.
- 모든 API 오류는 `{ "error": { "code": "...", "message": "..." } }` 형태다.

사용자, 팀, 세션, cookie, 역할, monitor update endpoint는 없다.

## 9. Admin UI

React 앱은 router 없이 하나의 관리 화면을 제공한다.

- monitor 이름, URL, status, 마지막 확인 시각/status code/latency를 목록으로 표시한다.
- uptime 생성 form은 name, URL과 `1..5` 실패 임계값을 받으며 기본값은 `2`다.
- 임계값 전의 연속 실패는 `Checking failure 1/2`처럼 현재 상태와 별도로 표시한다.
- 삭제 전 명시적 확인을 한다.
- Slack 테스트 알림 버튼과 성공/실패 feedback을 제공한다. webhook URL을 읽거나 수정하는 UI는 없다.
- loading, empty, error와 retry 상태를 표시한다.
- 최초 로드 후 30초 polling을 수행하고 unmount 시 timer를 정리한다.
- heartbeat URL, event history, webhook 설정, 공개 demo, chart는 표시하지 않는다.

React Router, query library, chart library, component framework는 사용하지 않는다.

## 10. Runtime modules

```text
shared/domain.ts
worker/validation.ts
worker/auth.ts
worker/db/monitors.ts
worker/routes/monitors.ts
worker/uptime.ts
worker/scheduled.ts
worker/notifications/slack.ts
worker/index.ts
src/App.tsx
src/api.ts
src/styles.css
```

모듈은 위 책임만 가진다. Slack 이외의 notification, 이벤트, job, demo 전용 module은 만들지 않는다.

## 11. Deployment

root `wrangler.jsonc`는 다음을 정의한다.

- Worker entrypoint
- D1 binding `DB`
- `* * * * *` Cron Trigger
- React Static Assets와 Worker-first API routing
- 고정 compatibility date
- Deploy to Cloudflare가 자동 provision할 이름 있는 D1 resource

README의 canonical 배포 흐름은 공식 Deploy to Cloudflare button 하나다.

1. README에서 Deploy to Cloudflare를 누른다.
2. Cloudflare와 GitHub/GitLab을 연결하고 Worker/resource 이름을 확인한다.
3. 필수 `ADMIN_SECRET`과 선택적 `SLACK_WEBHOOK_URL`을 입력한다.
4. Cloudflare가 repository clone, D1 provision/binding, migration, Worker/Static Assets/Cron Trigger 배포를 수행한다.
5. Basic Auth, Slack test, monitor 생성과 healthy/down/recovery를 확인한다.

`package.json`의 deploy script는 `wrangler d1 migrations apply DB --remote`를 포함한다. `.dev.vars.example`과 binding description은 secret 입력을 안내한다. 수동 Wrangler 흐름은 contributor와 troubleshooting을 위한 보조 경로로만 제공하며 여러 동등한 설치 방식을 비교하지 않는다.

## 12. Verification

자동 테스트는 제품 핵심 경로만 다룬다.

- domain/validation: status, DTO, name/URL과 실패 임계값 입력
- auth: 정상·실패 credential, missing secret, same-origin mutation
- monitors API: create/list/delete와 오류 형식
- uptime: 200~399, HTTP failure, timeout, network failure, no probe retry, manual redirect
- scheduled: 20개 cap, 오래된 순서, 연속 실패/복구, delayed tick replay 없음, internal error 상태 보존
- Slack: 상태 전이 집계, 중복 방지, missing secret, test endpoint, `429`/`5xx` 최대 3회와 non-retryable 오류
- dashboard: list, create, failure threshold, verifying failure, Slack test, delete, polling, loading/empty/error
- deployment: D1 자동 provision metadata, secret example, migration 포함 deploy script

완료에 필요한 명령은 다음과 같다.

```bash
npm ci
npm test
npm run build
```

추가로 local scheduled smoke와 clean Cloudflare account Deploy to Cloudflare smoke에서 Basic Auth, monitor CRUD, Slack test, uptime healthy/down/recovery와 D1/Cron 자동 생성을 확인한다. secret이나 실제 target URL은 로그와 문서에 기록하지 않는다.

## 13. Explicit MVP boundaries

- uptime monitor만 지원한다.
- 단일 관리자만 지원한다.
- 1분 Cron cadence와 best-effort 실행만 제공한다.
- uptime probe retry, catch-up, notification outbox/delivery guarantee, incident lifecycle, long-term history는 없다.
- Slack은 `429`와 `5xx`에 한해 같은 tick 안에서 최대 3회 시도한다.
- `/demo`, public status page, job heartbeat, Generic Webhook, Discord, Telegram, email은 없다.
- authenticated target, request body, response assertion, TCP, ICMP, browser check는 없다.
- Docker, VPS, Postgres, non-Cloudflare deployment는 없다.

## 14. Roadmap after uptime MVP

1. Job heartbeat와 `missed` deadline 상태
2. Event history와 7일 retention
3. Generic Webhook, Discord/Telegram과 영속 notification outbox
4. DNS/redirect-aware egress policy와 Workers VPC integration
5. Public fixture demo와 public status page
6. Incident lifecycle, rollups, multiple users/teams
7. 수요 검증 후 설치와 업그레이드를 대행하는 선택적 managed offering 검토

관리형 offering은 확정된 제품 약속이 아니다. 도입하더라도 BYO 배포의 단일 소유자·단일 D1 데이터 경계를 깨지 않고, 별도 control plane이 배포 생명주기를 대행하는 방향을 우선 검토한다.

## 15. License

첫 공개 릴리스는 정책 변경이 없다면 `AGPL-3.0-only`를 사용한다.
