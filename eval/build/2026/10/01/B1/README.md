# 파이썬 가계부 CLI

Python 3.9 이상, 표준 라이브러리만 사용합니다. 지출은 음수, 수입은 양수입니다.

```sh
python3 ledger.py --db ./ledger.json add 2026-10-01 -12000 식비 "점심 식사"
python3 ledger.py --db ./ledger.json list --month 2026-10 --category 식비
python3 ledger.py --db ./ledger.json report --month 2026-10
python3 ledger.py --db ./ledger.json delete 1
python3 ledger.py --db ./ledger.json import ./entries.csv
```

- DB와 부모 폴더가 없으면 생성합니다. JSON의 `next_id`를 보존하므로 삭제된 ID는 재사용하지 않습니다.
- `add`는 새 ID만, `delete`는 성공 시 아무것도 출력하지 않습니다.
- `list`는 날짜와 ID 오름차순으로 탭 구분 행을 출력합니다. 생략한 메모는 빈 문자열입니다.
- `report`는 합계와 카테고리 이름 오름차순으로 출력하고 마지막에 `TOTAL`을 출력합니다.
- 잘못된 입력과 DB/파일 오류는 stderr 메시지와 종료코드 2를 반환합니다. 정상 실행은 0입니다.
- 기존 DB를 읽을 수 없거나 구조가 잘못된 경우 덮어쓰지 않습니다. 변경은 임시 파일에서 원자적으로 교체합니다.

CSV는 UTF-8(선택적 BOM), 첫 행은 정확히 `date,amount,category,memo`이며 데이터 행은 네 필드입니다.

```csv
date,amount,category,memo
2026-10-01,-12000,식비,점심 식사
2026-10-02,3000000,급여,
```

유효하지 않은 데이터 행과 CSV 파싱 오류는 건너뛰며 stderr에 `line N: 이유`를 출력합니다.
`N`은 해당 레코드가 시작하는 실제 파일 줄 번호입니다. 인용된 여러 줄 메모도 지원합니다.
닫히지 않은 인용부호가 파일 끝까지 이어지면 그 부분은 하나의 잘못된 레코드로 처리합니다.
헤더 오류는 import 전체의 오류입니다. 정상 종료 시 stdout은 `imported X skipped Y`입니다.

테스트:

```sh
python3 -m unittest -v
```
