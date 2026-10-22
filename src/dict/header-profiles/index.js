/**
 * 저장소에 동봉하는 헤더 프로파일 목록.
 *
 * **새 프로그램·새 학년도 지원 = 이 폴더에 JSON 하나 추가하고 여기에 한 줄 넣기.**
 * 파서 코드는 건드리지 않는다.
 *
 * 사용자가 수동 매핑으로 만든 프로파일은 IndexedDB에 쌓이고, 같은 id면 이쪽을 덮는다.
 */

import kcue2025 from './kcue-2025.json' with { type: 'json' };
import kcue2026 from './kcue-2026.json' with { type: 'json' };
import kcue2027 from './kcue-2027.json' with { type: 'json' };
import senjinhak2026 from './senjinhak-2026.json' with { type: 'json' };
// 예시 양식도 프로파일로 읽는다. 체험 첫 화면이 「이름으로 알아냈다」 경고로 시작하지 않게 한다
import sample2026 from './sample-2026.json' with { type: 'json' };

export const bundledProfiles = [kcue2025, kcue2026, kcue2027, senjinhak2026, sample2026];
