# Small Group (그룹 공동체 공간)

Gather의 각 그룹(예: FGYG) 안에 있는 **승인된 회원 전체**가 함께 쓰는 공간입니다. 따로 소그룹을 만들거나 사람을 배정할 필요가 없습니다. 하단 메뉴 **Small Group**에 세 가지가 있습니다.

- **Events**: 리더가 모임(Meeting)·예배(Worship)·행사(Event)를 날짜·시간·장소·설명과 함께 올립니다. 회원은 **Going / Maybe / Can't go** 중 하나를 누르고(다시 누르면 취소), 누가 오는지 이름을 볼 수 있습니다. 지난 일정은 "Show past events"에 모입니다. 리더는 수정·삭제할 수 있습니다.
- **Prayer**: 누구나 기도 요청(제목·내용·카테고리 7개)을 올립니다. 공개 범위는 "그룹 전체" 또는 "Leaders only". 🙏 I Prayed는 한 사람당 한 번, 기도한 사람 수가 보입니다. 작성자나 리더가 "응답됨"으로 표시하고 간증을 붙일 수 있습니다.
- **Members**: 그룹의 리더와 회원 목록.

News 홈 카드에는 다음 일정과 내 응답, 새 기도 요청 **개수**만 보입니다(기도 내용은 표시하지 않음).

## 보안

- 일정 제목·장소·설명, 기도 제목·내용·간증은 공지와 똑같이 **그룹 키로 종단간 암호화**됩니다. 서버(운영자 포함)는 내용을 읽을 수 없습니다. 서버에 보이는 것은 작성자, 일정 시간, RSVP 응답, 공개 범위, 상태뿐입니다.
- 승인된 회원만 읽고 쓸 수 있습니다(대기·제외된 사람, 다른 그룹 불가).
- 일정 작성·수정·삭제는 리더만. RSVP는 **자기 응답만** 바꿀 수 있습니다.
- **"Leaders only" 기도는 작성자와 그 그룹 리더에게만** 서버가 돌려줍니다. 회원 앱은 "그룹 전체" 조회와 "내 것" 조회만 보냅니다.
- I Prayed는 `prayers/{id}/responses/{uid}` 기록과 숫자 +1을 함께 저장해야만 허용되어 중복·조작이 불가능합니다. 누가 기도했는지는 본인만 압니다.

데이터 위치: `churches/{churchId}/events/{eventId}` (`uid, startAt, iv, ct, rsvp{uid: going|maybe|no}, createdAt, updatedAt`), `churches/{churchId}/prayers/{prayerId}` (`uid, privacy, status, prayedCount, iv, ct, createdAt, answeredAt`).

## 알림

새 일정이 올라오면 "📅 (리더) posted a new event", 기도 요청은 "🙏 (이름) shared a prayer request"가 전송됩니다. 내용은 보내지 않습니다. Leaders only 기도는 리더에게만 알림이 갑니다.

## 테스트

```sh
node --test tests/small-groups.test.mjs           # 입력 검증·RSVP 집계
npm install --prefix tests --package-lock=false
cd tests && npm run rules                         # Firestore 에뮬레이터(demo-gather) 보안 규칙 테스트
```

보안 규칙 테스트 9개(회원만 열람, 리더만 일정 작성, 자기 RSVP만 변경, Leaders only 비공개, 기도 생성 검증, I Prayed 중복·조작 차단, 응답 권한, 그룹 삭제 시 정리)가 에뮬레이터에서 통과했습니다.

## 이전 설계

인수인계 받은 1단계(관리자가 소그룹을 만들고 회원을 배정하는 방식)는 실제 용도(그룹 전체의 일정·참석·기도 공유)와 달라 이 설계로 교체했습니다. 이전 데이터(`smallGroups/…`)는 더 이상 접근 규칙이 없습니다.
