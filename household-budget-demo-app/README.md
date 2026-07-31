# 우리집 가계부 (친구 공유용)

누구나 구글 계정으로 로그인해서 각자 자기만의 가계부로 쓸 수 있는 버전이에요.
로그인한 사람마다 데이터가 자동으로 분리돼서, 여러 명이 같은 링크를 써도 서로 안 보여요.
가족용 앱이랑 완전히 분리된 별도 배포예요.

## 1. Firebase 프로젝트 새로 만들기

가족용이랑 **다른 새 프로젝트**로 만들어주세요.

1. console.firebase.google.com → "프로젝트 추가" → 이름 예: `household-budget-demo`
2. **Firestore Database** 켜기 (위치: asia-northeast3, 프로덕션 모드)
3. **Authentication** 켜기 → 로그인 방법에서 "Google" 활성화
4. 프로젝트 설정 → "웹 앱 추가" → 나오는 firebaseConfig 값을 복사

## 2. firebaseConfig 넣기

`src/firebase.js` 파일을 열어서, 위에서 복사한 값으로 아래 부분을 바꿔주세요.

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

## 3. Firestore 보안 규칙 설정 (중요!)

Firestore Database → 규칙 탭에서 아래로 바꾸고 게시하세요.
가족용이랑 다르게, **로그인한 사람은 누구나** 쓸 수 있되 **자기 데이터만** 보고 고칠 수 있게 하는 규칙이에요.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 4. GitHub + Vercel 배포

가족용 때랑 똑같은 순서예요.

1. GitHub에 새 저장소 만들기 (예: `household-budget-demo`) — 이번엔 **Public**으로 해도 괜찮아요 (안에 실제 가족 데이터가 없으니까요)
2. 이 폴더 전체 업로드
3. vercel.com → 새 프로젝트로 이 저장소 Import → Deploy
4. 링크 생기면 그걸 친구들한테 공유하시면 돼요!

## 참고

- 로그인하면 빈 가계부로 시작해요 (샘플 데이터 없이 바로 실제 기록 가능)
- 각자 로그인한 사람마다 데이터가 자동으로 분리돼요 (서로 안 보임)
- 진짜 가족 데이터는 이 프로젝트에 전혀 안 들어있어요, 완전히 독립적이에요
