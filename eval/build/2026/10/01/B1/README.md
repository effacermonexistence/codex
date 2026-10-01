# 파이썬 가계부 CLI

Python 3.8 이상, 표준 라이브러리만 사용합니다. 모든 명령에 `--db`를 지정합니다.
JSON 파일이 없으면 생성하며, 파일의 상위 디렉터리는 이미 존재해야 합니다.

```bash
python3 ledger.py --db ledger.json add 2026-10-01 -12000 식비 "점심 식사"
python3 ledger.py --db ledger.json add 2026-10-02 3000000 급여
python3 ledger.py --db ledger.json list
python3 ledger.py --db ledger.json list --month 2026-10 --category 식비
python3 ledger.py --db ledger.json delete 1
python3 ledger.py --db ledger.json report --month 2026-10
python3 ledger.py --db ledger.json import transactions.csv
```

- `add`: 새 id만 출력합니다. 메모를 생략하면 빈 문자열로 저장합니다.
- `list`: 날짜·id 오름차순으로 `id<TAB>date<TAB>amount<TAB>category<TAB>memo`를 출력합니다.
- `delete`: 성공하면 출력하지 않습니다. 삭제한 id는 재사용하지 않습니다.
- `report`: 합계·카테고리 이름 오름차순으로 `category<TAB>sum`을 출력하고,
  마지막에 `TOTAL<TAB>합계`를 출력합니다. 해당 월에 기록이 없으면 `TOTAL<TAB>0`입니다.
- `import`: 아래 헤더의 UTF-8 CSV를 읽습니다(BOM도 허용). 잘못된 데이터 행은
  건너뛰고 stderr에 `line N: 이유`를 출력합니다. N은 헤더를 포함한 실제 파일 줄 번호이며,
  여러 줄짜리 CSV 레코드는 시작 줄을 사용합니다. 마지막 stdout은 `imported X skipped Y`입니다.

```csv
date,amount,category,memo
2026-10-01,-12000,식비,점심 식사
2026-10-02,3000000,급여,
```

날짜는 실제 존재하는 `YYYY-MM-DD`, 월은 `YYYY-MM`, 금액은 정수입니다.
잘못된 입력·없는 id·알 수 없는 명령·파일 오류는 stderr 메시지와 종료코드 2를 반환합니다.
잘못된 CSV 헤더나 읽을 수 없는 CSV는 오류이며, 가져오기의 일부만 저장하지 않습니다.
저장은 같은 디렉터리의 임시 파일을 원자적으로 교체하여 기존 파일의 잘림을 방지합니다.

JSON은 `{"next_id": 1, "entries": []}` 구조입니다.
`next_id`는 삭제 후에도 유지되며, 각 기록은 `id`, `date`, `amount`, `category`, `memo`를 저장합니다.

## 테스트

```bash
python3 -m unittest -v
```

임시 디렉터리와 실제 CLI 프로세스로 출력, 종료코드, 정렬, CSV 오류 줄 번호,
JSON 영속성, id 비재사용 및 오류 시 데이터 보존을 검사합니다.
