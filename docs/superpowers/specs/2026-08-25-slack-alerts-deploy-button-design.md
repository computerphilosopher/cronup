# CronUp Slack Alerts and Deploy Button MVP Design

## Background

CronUp의 uptime-only 범위는 Cloudflare 계정 하나에서 URL을 주기적으로 확인하고 현재 상태를 보여주는 기술 흐름에는 충분하지만, 사용자가 장애를 알아차리려면 관리 화면을 직접 열어야 한다. 또한 수동 배포는 `wrangler` 로그인, D1 생성과 binding, migration, secret 설정을 요구해 “모니터링 서버를 운영하지 않는다”는 제품 가치에 설치 마찰을 남긴다.

이번 변경은 MVP의 사용자 결과를 다음과 같이 확장한다.

```text
Deploy to Cloudflare → 관리자 인증 → URL과 실패 임계값 등록
→ 자동 GET 확인 → 확인된 장애/복구를 Slack으로 수신 → 현재 상태 조회
```

Slack 이외의 notification channel과 영속 notification outbox는 포함하지 않는다.

## Product decisions

- 첫 notification channel은 Slack Incoming Webhook 하나다.
- Slack webhook은 설치 전체에서 하나만 사용한다.
- `SLACK_WEBHOOK_URL`은 Worker secret이며 D1이나 client bundle에 저장하지 않는다.
- Slack 설정은 선택 사항이다. secret이 없거나 비어 있어도 uptime 확인과 상태 저장은 계속 동작한다.
- monitor마다 연속 실패 임계값을 `1`부터 `5`까지 선택한다. 기본값은 `2`다.
- 임계값은 monitor 생성 시 설정한다. MVP에는 monitor 수정 API를 추가하지 않는다.
- 실패 임계값에 도달하기 전까지 기존 `pending` 또는 `healthy` 상태를 유지하고, UI에는 확인 중인 실패 횟수를 별도로 표시한다.
- `pending | healthy`에서 임계값에 도달하면 `down`으로 전환한다.
- `down` 상태에서 성공이 한 번 발생하면 즉시 `healthy`로 복구한다.
- Slack 알림은 `pending | healthy → down`과 `down → healthy` 상태 전이에만 보낸다. 같은 상태가 지속될 때는 중복 발송하지 않는다.

## Domain and persistence

생성 입력과 monitor DTO를 다음 필드로 확장한다.

```ts
type CreateMonitorRequest = {
  name: string;
  url: string;
  failureThreshold?: number;
};

type MonitorDto = {
  // existing fields
  failureThreshold: number;
  consecutiveFailures: number;
};
```

`failureThreshold`가 생략되면 서버가 `2`를 사용한다. 정수가 아니거나 `1..5` 범위를 벗어나면 요청을 거부한다. client가 `consecutiveFailures`를 설정할 수는 없다.

`monitors` 테이블에는 다음 컬럼을 추가한다.

- `failure_threshold INTEGER NOT NULL DEFAULT 2 CHECK (failure_threshold BETWEEN 1 AND 5)`
- `consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0)`

probe 자체는 기존처럼 HTTP 결과 하나를 정규화한다. scheduler가 기존 row와 probe 결과를 결합해 카운터와 상태 전이를 결정한다. 성공 시 카운터를 `0`으로 만들고, 실패 시 카운터를 하나 증가시킨다.

## Slack delivery

한 scheduled tick에서 발생한 모든 down/recovery 전이를 Slack 메시지 하나로 묶는다. 메시지는 down과 recovered 구역을 각각 가지며 monitor 이름, URL, HTTP status 또는 오류 요약, 확인 시각을 포함한다. webhook secret 자체는 로그나 응답에 포함하지 않는다.

전송 정책은 bounded in-tick retry로 고정한다.

- 첫 시도와 재시도를 합쳐 최대 3회 호출한다.
- HTTP `429`와 `500..599`만 재시도한다.
- `429`에서는 유효한 `Retry-After` 값을 우선 사용하되 한 번의 대기는 최대 30초로 제한한다.
- `5xx`에서는 1초의 고정 backoff를 사용한다.
- 그 밖의 `4xx`와 network/configuration 오류는 즉시 최종 실패로 처리한다.
- 최종 실패는 webhook URL을 제외한 구조화된 로그로 남긴다.
- Slack 전송 실패는 이미 저장된 monitor 상태를 되돌리지 않는다.
- D1 outbox, 다음 Cron tick에서의 재생, delivery guarantee는 MVP에 포함하지 않는다.

관리 API에 same-origin과 Basic Auth로 보호되는 `POST /api/notifications/slack/test`를 추가한다. Slack secret이 없으면 일관된 `notification_not_configured` 오류를 반환한다. UI는 이 endpoint를 호출하는 테스트 알림 버튼을 제공한다.

## Deploy to Cloudflare

README의 canonical 설치 경로는 Cloudflare의 공식 Deploy button이다.

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](
  https://deploy.workers.cloudflare.com/?url=https://github.com/computerphilosopher/cronup
)
```

공개 source repository와 `wrangler.jsonc`를 바탕으로 Cloudflare가 Worker project를 만들고 D1 database를 provision/bind한다. deploy script는 binding 이름 `DB`를 사용해 remote migration을 적용한 뒤 Worker와 Static Assets, Cron Trigger를 배포한다.

`.dev.vars.example`은 배포 화면에서 다음 secret을 요청하는 계약을 제공한다.

```dotenv
ADMIN_SECRET=
SLACK_WEBHOOK_URL=
```

`package.json`의 Cloudflare binding description은 `ADMIN_SECRET` 생성 방법과 Slack Incoming Webhook URL 획득 방법을 설명한다. `SLACK_WEBHOOK_URL`은 선택 사항임을 명시한다.

사용자는 Cloudflare와 GitHub/GitLab 연결, secret 입력, 최종 deploy 확인을 수행해야 한다. 따라서 제품 문구는 문자 그대로의 “one click” 대신 “Deploy to Cloudflare로 몇 번의 클릭 안에 설치”를 사용한다. 수동 Wrangler 배포는 contributor와 troubleshooting을 위한 보조 경로로 남긴다.

## Admin UI

- monitor 생성 form에 실패 임계값 `1..5` 선택을 추가하고 기본값을 `2`로 둔다.
- 최근 probe가 실패했지만 임계값 전이면 `Checking failure 1/2`처럼 확인 중 상태를 표시한다.
- Slack 테스트 알림 버튼과 성공/실패 feedback을 제공한다.
- Slack webhook URL을 읽거나 수정하는 UI는 제공하지 않는다.
- notification history, channel별 routing과 message template editor는 제공하지 않는다.

## Error handling and security

- Slack webhook URL은 Worker secret으로만 읽으며 API, HTML, 로그에 노출하지 않는다.
- test endpoint와 monitor mutation은 기존 Basic Auth, JSON content type, same-origin 정책을 따른다.
- missing Slack secret은 monitoring failure가 아니라 notification configuration 상태다.
- scheduler의 D1 또는 코드 오류가 발생하면 기존 상태를 보존하고 Slack 상태 전이를 생성하지 않는다.
- probe 결과 저장이 성공한 뒤에만 해당 전이를 Slack batch에 포함한다.

## Verification

자동 테스트는 다음을 고정한다.

- 기본 실패 임계값 `2`, 명시적 `1..5`, 범위 밖 입력 거부
- 연속 실패 증가와 성공 시 초기화
- 임계값 전 상태 유지와 임계값 도달 시 단일 down 전이
- 성공 1회에 의한 즉시 recovery와 중복 알림 방지
- 한 tick의 여러 전이를 Slack 메시지 하나로 집계
- `429`의 `Retry-After`, `5xx` bounded retry, non-retryable `4xx`, 최대 3회
- missing secret에서도 uptime 지속, test endpoint의 일관된 오류
- Slack 실패가 monitor 상태를 되돌리지 않음
- Deploy button용 D1 provisioning metadata, secret example, migration 포함 deploy script
- clean-account Deploy to Cloudflare smoke에서 D1 migration, secret, Worker, assets와 Cron Trigger 생성

## Explicit exclusions

- Discord, Telegram, email과 Generic Webhook
- monitor별 Slack channel과 여러 webhook
- Slack OAuth/Marketplace app
- persistent notification outbox와 delivery guarantee
- notification history와 template editor
- 실패 임계값 수정 API
