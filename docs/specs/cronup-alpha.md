# CronUp Uptime Alpha Specification

## 1. Product purpose

작은 EC2 한 대로 운영하는 tiny project에도 외부 모니터링은 필요하다. 그러나 전통적인 모니터링 제품은 agent 실행 서버, 분산 조정 계층, 별도 시계열 저장소처럼 감시 대상에 버금가는 인프라와 운영비를 요구할 수 있다. 이 프로젝트는 작은 프로젝트의 모니터링이 프로젝트 자체보다 무거워서는 안 된다는 문제의식에서 출발한다.

CronUp은 사용자의 Cloudflare 계정에 직접 배포하는 단일 관리자용 uptime monitor다. Cloudflare Workers, Cron Triggers, D1, Static Assets를 함께 사용해 별도 상시 서버와 시계열 데이터베이스 없이 HTTP(S) endpoint의 현재 상태를 확인한다. Cloudflare Free plan에서 작은 배포를 운영할 수 있는 비용 구조를 지향하지만, 특정 사용량의 무료 운영을 보장하지는 않는다.

이번 MVP가 검증하는 질문은 하나다.

> 작은 프로젝트의 관리자가 별도 모니터링 서버를 운영하지 않고 URL을 등록해 현재 uptime 상태를 확인할 수 있는가?

Cron job heartbeat, 알림 전송, 이벤트 분석, 공개 demo는 이번 릴리스의 제품 약속이 아니다. 이 문서에서 명시한 기능 외에는 MVP 기능으로 간주하지 않는다.

`CronUp`은 개발 중 사용하는 임시 제품명이다. uptime-only 제품에 맞는 이름은 MVP 방향이 검증된 뒤 결정하며, 제품명이 확정될 때 repository 이름도 함께 변경한다.

## 2. Stack and deployment boundary

제품은 다음 다섯 기술만 사용한다.

1. TypeScript
2. Cloudflare Workers
3. Hono
4. Cloudflare D1 raw SQL
5. React + Vite

Cloudflare Cron Trigger와 Static Assets는 플랫폼 기능이다. runtime dependency는 `hono`, `react`, `react-dom`만 사용한다. ORM, query library, router, Queue, Durable Objects, KV, R2, Redis, 외부 DB와 외부 notification provider는 사용하지 않는다.

배포 단위는 Worker 하나다. Worker는 `fetch()`로 API와 React 자산을 제공하고, `scheduled()`로 uptime tick을 처리한다. 제품은 BYO Cloudflare, 단일 관리자, best-effort 환경이며 SaaS 용량·실행 시각·가용성 SLA를 약속하지 않는다.

첫 제품은 BYO Cloudflare 배포를 중심으로 한다. 사용자·조직·과금·중앙 control plane을 미리 만들지 않으며 monitor 데이터와 secret은 배포 소유자의 Cloudflare 계정 안에 둔다. 향후 관리형 배포를 제공할 가능성은 열어 두되, MVP 아키텍처와 완료 조건은 관리형 SaaS를 전제로 하지 않는다.

## 3. Monitor model

```ts
type MonitorStatus = "pending" | "healthy" | "down";

type CreateMonitorRequest = {
  name: string;
  url: string;
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
};
```

모든 시간은 UTC epoch milliseconds다. 외부 입력은 작은 수동 함수로 검증한다. monitor type discriminator, heartbeat token, deadline, event DTO는 없다.

## 4. Uptime checks

- 생성 시 monitor는 `pending`이다.
- Cloudflare Cron Trigger가 1분마다 한 번 실행한다.
- 가장 오래 확인되지 않은 monitor를 최대 20개 선택한다.
- 각 monitor는 HTTP `GET` 한 번만 보낸다.
- timeout은 10초이며 retry는 하지 않는다.
- 요청은 `redirect: "manual"`로 보낸다. redirect 대상에 추가 요청을 하지 않는다.
- HTTP status 200~399는 `healthy`, 그 밖의 status·timeout·DNS 오류·network 오류는 `down`이다.
- 성공/실패 결과는 monitor row의 status, `last_checked_at`, `status_code`, `latency_ms`를 갱신한다.
- uptime check가 성공하면 하나의 결과만 저장한다. 과거에 지연된 Cron tick을 재생하지 않는다.
- CronUp 자체의 D1 또는 코드 오류가 발생하면 해당 monitor의 기존 상태를 보존한다.

latency는 probe 시작과 종료의 monotonic clock 차이로 계산하며 epoch 시각으로 대체하지 않는다.

## 5. URL and request validation

생성 API는 `{ name, url }` 외의 필드를 받지 않는다.

- 이름은 trim 후 1~100자다.
- URL은 `http:` 또는 `https:`만 허용한다.
- URL의 username/password는 거부한다.
- malformed URL과 빈 문자열은 거부한다.
- custom IPv4/IPv6 parser와 DNS lookup은 MVP에 포함하지 않는다.
- redirect 체인과 DNS rebinding 검사는 uptime probe의 후속 보안 작업으로 남긴다.

관리 API는 Basic Auth로 보호되고, 기본 Workers egress 정책을 전제로 한다. 이 문서는 URL 검증을 완전한 SSRF 방어라고 주장하지 않는다.

## 6. Persistence

D1에는 `monitors` 테이블 하나만 만든다.

필드:

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `url TEXT NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('pending', 'healthy', 'down'))`
- `last_checked_at INTEGER`
- `last_status_code INTEGER`
- `last_latency_ms INTEGER`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

필수 query는 create, list, delete, least-recently-checked selection, result update다. 모든 외부 값은 prepared statement bind로 전달한다. 이벤트 테이블, FK cascade, retention index, batch event insert는 없다.

## 7. Authentication and API

관리 화면 `/`과 아래 admin API는 HTTP Basic Auth가 필요하다.

```text
GET    /api/monitors
POST   /api/monitors
DELETE /api/monitors/:id
```

- username은 고정 `admin`이다.
- password는 Worker secret `ADMIN_SECRET`이다.
- secret이 없거나 비어 있으면 fail closed하고 항상 `401` challenge를 반환한다.
- 실패 응답은 `WWW-Authenticate: Basic realm="CronUp"`를 포함한다.
- POST/DELETE는 JSON이 필요한 경우 `application/json`과 same-origin `Origin`을 검사한다.
- 삭제는 `204`를 반환한다. 존재하지 않는 id는 일관된 `404` 오류를 반환한다.
- 모든 API 오류는 `{ "error": { "code": "...", "message": "..." } }` 형태다.

사용자, 팀, 세션, cookie, 역할, update endpoint는 없다.

## 8. Admin UI

React 앱은 router 없이 하나의 관리 화면을 제공한다.

- monitor 이름, URL, status, 마지막 확인 시각/status code/latency를 목록으로 표시한다.
- uptime 생성 form은 name과 URL만 받는다.
- 삭제 전 명시적 확인을 한다.
- loading, empty, error와 retry 상태를 표시한다.
- 최초 로드 후 30초 polling을 수행하고 unmount 시 timer를 정리한다.
- heartbeat URL, event history, webhook 설정, 공개 demo, chart는 표시하지 않는다.

React Router, query library, chart library, component framework는 사용하지 않는다.

## 9. Runtime modules

```text
shared/domain.ts
worker/validation.ts
worker/auth.ts
worker/db/monitors.ts
worker/routes/monitors.ts
worker/uptime.ts
worker/index.ts
src/App.tsx
src/api.ts
src/styles.css
```

모듈은 위 책임만 가진다. 이벤트·notification·job·demo 전용 module은 만들지 않는다.

## 10. Deployment

root `wrangler.jsonc`는 다음을 정의한다.

- Worker entrypoint
- D1 binding `DB`
- `* * * * *` Cron Trigger
- React Static Assets와 Worker-first API routing
- 고정 compatibility date

README의 첫 배포 흐름은 하나만 제공한다.

1. `npm install`과 `wrangler login`
2. D1 생성과 `wrangler d1 migrations apply DB --remote`
3. `wrangler secret put ADMIN_SECRET`
4. `npm run build`와 `npm run deploy`
5. Basic Auth, monitor 생성, uptime 결과를 수동 확인

자동 provisioning fallback, Deploy 버튼, 다중 배포 방식 비교는 문서에 넣지 않는다.

## 11. Verification

자동 테스트는 제품 핵심 경로만 다룬다.

- domain/validation: status, DTO, name/URL 입력
- auth: 정상·실패 credential, missing secret, same-origin mutation
- monitors API: create/list/delete와 오류 형식
- uptime: 200~399, HTTP failure, timeout, network failure, no retry, manual redirect
- scheduled: 20개 cap, 오래된 순서, delayed tick replay 없음, internal error 상태 보존
- dashboard: list, create, delete, polling, loading/empty/error

완료에 필요한 명령은 다음과 같다.

```bash
npm ci
npm test
npm run build
```

추가로 local scheduled smoke와 clean Cloudflare account 배포 smoke에서 Basic Auth, monitor CRUD, uptime healthy/down 전이를 확인한다. secret이나 실제 target URL은 로그와 문서에 기록하지 않는다.

## 12. Explicit MVP boundaries

- uptime monitor만 지원한다.
- 단일 관리자만 지원한다.
- 1분 Cron cadence와 best-effort 실행만 제공한다.
- retry, catch-up, delivery guarantee, incident lifecycle, long-term history는 없다.
- `/demo`, public status page, job heartbeat, Generic Webhook은 없다.
- authenticated target, request body, response assertion, TCP, ICMP, browser check는 없다.
- Docker, VPS, Postgres, non-Cloudflare deployment는 없다.

## 13. Roadmap after uptime MVP

1. Job heartbeat와 `missed` deadline 상태
2. Event history와 7일 retention
3. Generic Webhook과 notification outbox/retry
4. DNS/redirect-aware egress policy와 Workers VPC integration
5. Public fixture demo와 public status page
6. Incident lifecycle, rollups, multiple users/teams
7. 수요 검증 후 설치와 업그레이드를 대행하는 선택적 managed offering 검토

관리형 offering은 확정된 제품 약속이 아니다. 도입하더라도 BYO 배포의 단일 소유자·단일 D1 데이터 경계를 깨지 않고, 별도 control plane이 배포 생명주기를 대행하는 방향을 우선 검토한다.

## 14. License

첫 공개 릴리스는 정책 변경이 없다면 `AGPL-3.0-only`를 사용한다.
