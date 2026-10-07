# 그룹 생활: News 이벤트 · 오늘의 묵상 · 기도

- **News 탭 – 이벤트**: 리더가 "＋ New event"로 모임·예배·행사를 올리면, 회원은 **Going / Maybe / Can't go**를 누릅니다(다시 누르면 취소). 누가 오는지 이름으로 볼 수 있습니다.
- **Small Group 탭 – Today's Devotion(오늘의 묵상)**: 누구나 성경 구절과 묵상을 올립니다. ❤️ 좋아요(한 사람 한 번, 취소 가능)와 💬 댓글. 묵상·댓글 모두 **익명**으로 올릴 수 있습니다.
- **Small Group 탭 – Prayer(기도)**: 누구나 기도 요청을 올립니다. **익명** 가능, 공개 범위는 그룹 전체 / Leaders only. 🙏 I Prayed(한 사람 한 번), 응답됨·간증.
- **Members**: 그룹 사람 목록.

## 익명 글은 어떻게 보호되나요
익명 글에는 작성자 정보가 아예 저장되지 않습니다(`uid: null`). 대신 작성자만 읽을 수 있는 비공개 기록(`owners/{글id}`)이 따로 생겨서, 작성자는 자기 글을 지우거나(기도는 응답 표시도) 관리할 수 있습니다. 다른 회원은 물론 **리더도 누가 썼는지 알 수 없습니다.** 리더는 부적절한 글을 삭제할 수는 있습니다. (Firebase 프로젝트 소유자는 서버 기록으로 연결을 알 수 있지만, 글 내용은 암호화되어 읽을 수 없습니다.)

## 보안 (서버 규칙으로 강제)
- 승인된 회원만 읽고 쓸 수 있습니다.
- 이벤트 작성·수정·삭제는 리더만, RSVP는 자기 응답만.
- Leaders only 기도는 작성자와 리더에게만 전달.
- 좋아요/I Prayed는 개인 기록과 숫자 변경을 함께 저장해야만 허용되어 중복·조작 불가.
- 모든 글 내용은 그룹 키로 종단간 암호화.

데이터: `churches/{id}/events`, `/prayers` (+`responses/{uid}`), `/devotions` (+`likes/{uid}`), `/devComments`, `/owners`.

## 알림 (내용 없이)
새 이벤트 "📅 … posted a new event", 기도 "🙏 … shared a prayer request", 묵상 "📖 … shared today's devotion", 내 묵상에 댓글 "💬 … commented on your devotion". 익명 글은 "Someone"으로 표시됩니다.

## 테스트
```sh
node --test tests/small-groups.test.mjs      # 입력 검증 등
./tests/run-rules-local.sh                   # 공식 Firestore 에뮬레이터로 보안 규칙 14개 (npm 불필요, Java 필요)
```
