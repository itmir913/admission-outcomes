# 헤더 프로파일 — 새 양식 지원하기

새 프로그램이나 새 학년도 엑셀을 지원하는 방법. **파서 코드는 건드리지 않는다.**

## 언제 필요한가

파일을 올렸을 때 "열 구성을 알아보지 못했습니다"가 뜨면 그 양식의 프로파일이 없는 것이다.
헤더가 한 열이라도 바뀌면 지문이 달라지므로, 같은 프로그램이라도 새 프로파일이 필요할 수 있다.

## 프로파일 한 장

`src/dict/header-profiles/<program>-<year>.json`

```json
{
  "id": "kcue-2024",
  "program": "kcue",
  "programLabel": "대교협 수시진학관리",
  "year": 2024,
  "headerRows": 2,
  "fingerprint": "3ae3b901…",
  "yearBasis": "admission",
  "columns": {
    "univ": 6,
    "dept": 12,
    "gpa.전교과": 37,
    "suneung.국어.grade": 64
  }
}
```

| 항목 | 뜻 |
|---|---|
| `headerRows` | 헤더가 몇 줄인지. 대교협은 2줄 |
| `fingerprint` | 정규화한 헤더 시퀀스 **전체**의 SHA-256. 열이 하나라도 바뀌면 달라진다 |
| `yearBasis` | 연도 열의 값이 `senior`(고3 년도)인지 `admission`(학년도)인지. **연도 열이 있으면 필수** |
| `columns` | 논리 키 → **열 인덱스**(0부터) |

## 논리 키

`src/dict/fields.json`이 사전이다. 없는 키를 쓰면 검사에서 거절된다.

```
스칼라   univ, dept, admType, admName, stage1, final, failReason, register, …
식별용   identity.name, identity.hakbun, identity.class, identity.number
연도     cohortYear, sourceYear
되풀이   gpa.<반영조합>            gpa.전교과, gpa.국영수사/과(2/4/4)
         suneung.<영역>.<항목>     suneung.국어.grade, suneung.탐구1.percentile
```

되풀이 묶음의 이름(반영조합·수능 영역)은 **자유 문자열**이다. 학교마다 다른 조합이 나와도
사전을 고칠 필요가 없다. 수능 항목은 `subject` `stdScore` `percentile` `grade` 넷뿐이다.

새 **개념**이 필요할 때만 `fields.json`에 한 줄 추가한다.

## 만드는 법

열 번호를 손으로 세지 말고 도구를 쓴다.

```bash
node scripts/author-profile.mjs "경로/파일.xlsx" --rows=2 --program=kcue --label="대교협 수시진학관리" --year=2024
```

헤더를 열 번호와 함께 출력하고, 이름 힌트로 초안을 만들어 검사 결과까지 보여준다.
눈으로 확인한 뒤 `--write`를 붙이면 `src/dict/header-profiles/`에 저장된다.

옵션: `--sheet=시트명`, `--basis=admission|senior`

도구는 **초안만** 만든다. 최종 판단은 사람이 한다. 특히 이런 것들:

- 도구가 못 잡은 열 (매핑된 열 수를 전체와 비교해 볼 것)
- 헤더 이름이 모호한 열 (센진학의 `등급.2`처럼 어느 영역인지 안 적힌 것)
- 잘못 잡은 열

## 등록

`src/dict/header-profiles/index.js`에 한 줄 추가한다.

```js
import kcue2025 from './kcue-2025.json' with { type: 'json' };
export const bundledProfiles = [kcue2024, kcue2025, senjinhak2026];
```

`tests/bundled-profiles.test.js`가 자동으로 검사한다 — 필드 키가 사전에 있는지,
지문 형식이 맞는지, 두 필드가 같은 열을 가리키지 않는지, 대학명 열이 있는지.

## 학년도를 물려쓰는 규칙

1. 그 학년도 프로파일과 **지문이 맞으면** 쓴다
2. 없으면 **가장 최신 학년도부터 역순으로** 지문을 대조한다.
   양식이 안 바뀐 해는 여기서 걸리므로, 2025 프로파일이 2026 파일에 그대로 맞는 일이 흔하다
3. 전부 어긋나면 헤더가 실제로 바뀐 것이다 → 이름 매칭 폴백 → 수동 매핑

**지문 대조를 건너뛰지 않는다.** 열이 하나만 늘어도 인덱스는 통째로 밀리고,
프로파일이 있다는 이유로 믿으면 조용히 엉뚱한 열을 읽는다.

## 구역(section) 판정

이름 매칭 폴백에서 쓴다. 대교협 파일에는 `국어`·`수학`·`영어`가 **내신 구역과 수능 구역에
각각 한 번씩** 나오므로 이름만으로는 갈리지 않는다.

앵커로 경계를 잡는다 — `전교과`가 나오면 그 언저리가 내신 구역, `한국사`가 나오면
그 이후가 수능 구역. 구역을 가른 뒤에 이름 매칭을 한다.
