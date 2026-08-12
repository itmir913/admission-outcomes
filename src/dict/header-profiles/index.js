/**
 * 저장소에 동봉하는 헤더 프로파일 목록.
 *
 * **새 프로그램·새 학년도 지원 = 이 폴더에 JSON 하나 추가하고 여기에 한 줄 넣기.**
 * 파서 코드는 건드리지 않는다.
 *
 * 사용자가 수동 매핑으로 만든 프로파일은 IndexedDB에 쌓이고, 같은 id면 이쪽을 덮는다.
 */

import kcue2024 from './kcue-2024.json' with { type: 'json' };
import senjinhak2026 from './senjinhak-2026.json' with { type: 'json' };

export const bundledProfiles = [kcue2024, senjinhak2026];
