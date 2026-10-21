# camtic-micro-sim-view

총괄5-세부1 기술실증 테스트베드의 로컬 OCS·시뮬레이션 Cell 뷰어/산출물 작업 공간이다.

지식은 두 폴더다. **섞지 않는다.** 원문 사이트보다 이 폴더를 우선한다.

| 폴더 | 쓰는 때 |
|---|---|
| `context/` | OCS 산정·존·셀·견적·용량·심의 |
| `docx/` | Jin-micro 시뮬·CAMTIC 수집/AAS **구현** |

개발 아키텍처 한 장: `docx/ARCHITECTURE.md`. 시뮬·현장 수집·목표 OCS를 같은 버스처럼 그리지 않는다.

뷰어 코드(`index.html` `js/` `server/` `tests/`): `docx/10-viewer.md`. `npm start` → `.env`의 HOST:PORT, `npm test`.

- 상태: 설계 추정본. 미확정은 `context/07-open-issues.md` · `docx/09-limits-and-join.md` — 확정처럼 쓰지 않는다.
- 금액: 천원, VAT 별도. 수치는 `context/facts.json`과 맞춘다.
- 역할: OCS=수집·감독·재계획. 실시간 제어=셀 PLC. 학습 DT=Isaac. 검증 DT=DMWorks. 시뮬의 오케스트레이터는 같은 역할의 JS 모듈이지 하드웨어 OCS가 아니다.
- 정밀조립 A-3 자체 산정과 이지로보틱스 10/15 턴키 3존을 섞지 않는다. 시뮬 셀 ID(SORT…)와 A-3-n도 맞추지 않는다.
- 제출·발표 문구에는 업체·모델명을 쓰지 않는다. 일반 명칭과 `제어기 n종`을 쓴다.
