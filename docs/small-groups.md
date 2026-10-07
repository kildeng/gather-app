# Small Groups · Phase 1–2

Gather의 기존 Google 로그인, Firebase Firestore, 모바일 카드·하단 메뉴를 확장했습니다. Supabase, 새 프레임워크, 런타임 의존성 추가는 없습니다. 기존 암호화 공지·채팅과 소그룹은 별개입니다. 교회 아래에 여러 소그룹을 만들 수 있고, 한 사람은 여러 소그룹에 속할 수 있습니다.

## 구현 범위

- News에 `Your Small Group` 카드, 하단에 `Small Groups` 메뉴
- My Group: 이름·설명·그룹 이미지·리더·회원 수·주간 모임 일정·장소
- Members: 해당 소그룹의 이름·사진·역할만 표시, 이메일·연락처 제외
- 관리자: 그룹 생성·수정·보관, 리더 지정, 회원 추가·제외
- 소그룹 리더: 담당 그룹의 소개·이미지·모임 일정만 수정
- 목회자: 같은 교회의 모든 소그룹과 회원 목록 조회
- 가입 대기·제외·로그아웃 시 접근 차단 및 화면 데이터 정리

실제 날짜를 가진 다음 모임, RSVP·출석, 기도, 토론, 피드, 체크인, 돌봄 대시보드는 후속 단계입니다. 주간 일정만으로 가짜 다음 모임 날짜나 활동을 만들지 않습니다. 일반 회원에게 후속 기능의 개인 기도·체크인 자료를 전달하는 API는 이번 단계에 없습니다.

## 권한

기존 `churches/{churchId}/members/{uid}.role`의 `member`/`leader`는 기존 교회 기능 권한입니다. 소그룹 권한과 구분합니다.

| 소그룹 역할 | 부여 방식 | 범위 |
| --- | --- | --- |
| ADMIN | 교회 생성자이면서 현재 교회 리더, 또는 교회별 서버 인증 클레임 | 해당 교회의 모든 소그룹 관리 |
| PASTOR | 교회별 서버 인증 클레임 | 해당 교회의 모든 소그룹 조회 |
| LEADER | 소그룹 `leaderId`이며 `memberIds`에 포함 | 담당 소그룹의 기본 정보 수정 |
| MEMBER | 소그룹 `memberIds`에 포함 | 소속 소그룹과 회원 목록 조회 |

모든 역할에는 현재 승인된 교회 회원 자격이 필요합니다. 교회 리더라는 이유만으로 다른 소그룹 관리자가 되지는 않습니다. `/users/{uid}`나 클라이언트의 역할 값으로 권한을 올릴 수 없습니다.

추가 ADMIN/PASTOR는 신뢰할 수 있는 Firebase Admin SDK 관리 환경에서 `smallGroupRoles: { [churchId]: 'ADMIN' 또는 'PASTOR' }` 인증 클레임으로 부여해야 합니다. 기존 클레임을 보존해서 합치고, 부여 후 해당 사용자의 인증 토큰을 갱신하거나 다시 로그인하세요. 앱에는 클레임을 발급하는 공개 엔드포인트나 관리자 비밀키가 없습니다.

회원 이동은 목적지 그룹에 추가하고 원래 그룹에서 제외하는 두 번의 그룹 편집으로 수행합니다. 두 그룹 사이 이동을 하나의 원자적 작업으로 제공하지는 않습니다.

## 데이터

`churches/{churchId}/smallGroups/{groupId}`:

- `name`, `description`, `imageUrl`
- `leaderId`, `memberIds` (중복 없는 최대 100명, 리더 포함)
- `meetingDay`, `meetingTime` (`HH:mm`), `meetingLocation`
- `status` (`active` / `archived`)
- 서버 시각 `createdAt`, `updatedAt`

`.../smallGroups/{groupId}/members/{uid}`에는 `firstName`, HTTPS `photo`, `bio`만 저장합니다. 현재 입력 화면은 기본 디렉터리만 만들며, 소개 편집은 제공하지 않습니다. 관리자 저장은 승인된 교회 회원 문서를 읽고 그룹과 디렉터리를 트랜잭션으로 함께 갱신합니다. 첫 이름은 기존 표시 이름의 첫 단어를 사용합니다. 이름 수정 시 디렉터리 자동 동기화는 아직 없으며 관리자 그룹 저장 시 갱신됩니다.

소그룹 소개·일정·디렉터리는 Firestore 접근 규칙으로 보호하지만 종단간 암호화된 상담 자료가 아닙니다. 상담 메모나 민감한 기도 내용을 여기에 입력하지 마세요. 기존 메시지·첨부·공지의 암호화 방식은 바뀌지 않습니다. 보관은 그룹의 상태 표시이며, 기존 소속 회원의 조회 권한을 취소하지 않습니다.

## 배포

1. 아래 보안 테스트를 먼저 실행하고 통과를 확인합니다.
2. `firebase/firestore.rules`의 전체 규칙을 Firebase Console의 Firestore Rules에 게시합니다. Netlify 배포는 Firestore 규칙을 게시하지 않습니다.
3. 변경한 정적 파일을 기존 Netlify 배포 방식으로 배포합니다. `netlify.toml` 변경이나 새 환경 변수는 필요하지 않습니다.
4. 교회 생성자 계정으로 Small Groups에서 그룹을 만들고, 승인된 회원과 리더를 배정합니다.
5. 별도 회원·리더·목회자 계정으로 접근 범위를 확인합니다.

기존 데이터 마이그레이션은 필요 없습니다. 새 컬렉션은 첫 그룹 생성 시 만들어집니다. 기존 그룹 목록을 소그룹으로 자동 복사하지 않습니다. 이번 개발 작업에서는 운영 규칙 게시, Netlify 배포, 운영 데이터 쓰기를 수행하지 않았습니다.

## 검증

런타임 의존성을 바꾸지 않기 위해 테스트 도구는 `tests/package.json`에 분리했습니다.

```sh
node --test tests/small-groups.test.mjs
npm install --prefix tests --package-lock=false
cd tests
npm run rules
# 별도 터미널에서 기존 Netlify 개발 서버를 실행한 뒤:
CHROMIUM_PATH=/usr/bin/chromium npm run browser
```

규칙 테스트는 **demo-gather 에뮬레이터만** 사용하며 운영 Firebase에 연결하지 않습니다. 에뮬레이터 다운로드에는 `storage.googleapis.com` 접근과 Java가 필요합니다. 클라우드의 기본 캐시 경로를 사용할 수 없다면 `FIREBASE_EMULATORS_PATH=/workspace/.sg-test-tools/emulators`, `XDG_CONFIG_HOME=/workspace/.sg-test-tools/config`를 지정하세요.

브라우저 테스트는 테스트 페이지의 기존 미리보기 모드만 켜며 파일의 Firebase 설정을 변경하지 않습니다. 관리자 생성·배정·수정·보관, 회원 화면, 그룹 구분, 로그아웃 정리, 기존 공지·채팅과 모바일 스크롤을 검증합니다. 실제 Google 로그인 세션 유지나 운영 Firestore 접근을 검증하는 테스트는 아닙니다.

현재 검증 결과: 역할·입력·회원 디렉터리 갱신 단위 테스트 5개와 미리보기 브라우저 검증(320/390px 모바일, 데스크톱)이 통과했습니다. 실제 Firebase SDK를 TLS 검증한 프록시 요청으로 받아 초기화하고 로그인 화면을 확인했으며, 인증된 계정의 로그인 지속성·운영 데이터 동작은 검증하지 않았습니다. 규칙 테스트는 에뮬레이터 다운로드가 네트워크 정책의 HTTP 403으로 차단되어 실행하지 못했습니다. 필요한 `storage.googleapis.com` 도메인을 환경 설정 초안에 추가했습니다. 설정 적용 후 규칙 테스트를 실행해야 하며, 서버 권한 검증을 완료하기 전에는 운영 배포를 준비 완료로 간주하지 마세요.

## 다음 단계

Phase 2는 기도 요청·중복 없는 I Prayed·응답 간증과 그룹/리더 전용 읽기 규칙, Phase 3는 날짜 있는 모임·RSVP·출석, Phase 4는 주간 토론, Phase 5는 피드, Phase 6는 비공개 체크인·돌봄, Phase 7은 관리 화면 확대와 보안·모바일 최종 검증입니다. 각 단계에서 별도 데이터 경로, 최소 접근 권한과 테스트를 함께 추가합니다.


## Phase 2 · 기도 요청 (완료)

- 데이터: `churches/{churchId}/smallGroups/{groupId}/prayers/{prayerId}` — `uid`, `title`(≤80), `request`(≤1000), `category`(Personal/Family/Health/School/Work/Faith/Other), `privacy`(`group`/`leaders`), `status`(`active`/`answered`), `testimony`(≤500), `prayedCount`, `createdAt`, `answeredAt`.
- "I Prayed": `prayers/{id}/responses/{uid}` 문서(아이디 = 사용자 uid)와 `prayedCount` +1을 한 번에 저장해야만 허용됩니다. 같은 사람은 두 번 셀 수 없고, 누가 기도했는지는 본인만 볼 수 있습니다.
- "Leaders Only" 요청은 **작성자와 그 소그룹 리더만** 읽을 수 있습니다. 같은 그룹 회원·목회자·관리자에게도 서버가 돌려주지 않습니다. 회원 앱은 `privacy == 'group'` 조회와 `uid == 본인` 조회만 보냅니다.
- 그룹 전체 요청은 그룹 회원과 목회자/관리자가 읽을 수 있습니다. 새 요청은 그룹 회원만 올릴 수 있습니다(보관된 그룹 제외).
- 응답 표시와 간증은 작성자 또는 그룹 리더만 할 수 있습니다. 삭제도 작성자 또는 리더만 가능합니다.
- 홈(News) 카드에는 새 기도 요청 **개수만** 표시하고 내용은 보여주지 않습니다.
- 규칙 테스트 13개(에뮬레이터, demo-gather) 통과: 리더 전용 비공개, 다른 그룹 차단, 생성 검증, 중복 I Prayed 차단, 응답 권한.
