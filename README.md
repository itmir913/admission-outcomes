# 진학결과 시각화 시스템

과년도 대입 결과 엑셀을 브라우저에 올려 익명 상태로 분석·시각화하는 상담 도구.
**서버 없음. 계정 없음. 파일 내보내기 없음.**

```bash
npm install          # SheetJS는 공식 CDN 타르볼을 쓴다. docs/plan.md 기술 스택 참조
npm test             # vitest
npm run dev          # vite
```

## 문서

| | |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 절대 규칙. 어길 수 없는 것들 |
| [docs/plan.md](docs/plan.md) | 설계 전체 |
| [docs/decisions.md](docs/decisions.md) | 무엇을 왜 정했고 무엇을 버렸는지 |
| [docs/roadmap.md](docs/roadmap.md) | 구현 순서 |
| [docs/header-profiles.md](docs/header-profiles.md) | 새 엑셀 양식 지원하기 |

## 기능

- 업로드 (엑셀 여러 개 · zip) → 학년도 인식 → 헤더 프로파일 매칭
- 익명화 · 자료 모델 조립 (students / applications / suneung)
- 필터·검색, 대학×전형 요약표, 학생별 지원 결과 화면
- IndexedDB 보관 · 파일 단위 되돌리기 · 전체 지우기

앞으로 만들 것은 [docs/roadmap.md](docs/roadmap.md)에 있다.
