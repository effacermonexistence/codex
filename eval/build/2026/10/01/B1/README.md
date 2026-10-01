# ledger.py — 파이썬 가계부 CLI

표준 라이브러리만 쓰는 단일 파일 가계부입니다 (Python 3.9+).

```sh
python3 ledger.py --db ledger.json add 2024-03-05 -12000 식비 점심   # 1
python3 ledger.py --db ledger.json list --month 2024-03
python3 ledger.py --db ledger.json report --month 2024-03
python3 ledger.py --db ledger.json import transactions.csv
python3 ledger.py --db ledger.json delete 1
```

| 명령 | 동작 |
|---|---|
| `add <YYYY-MM-DD> <금액> <카테고리> [메모]` | 금액은 정수(원), 지출은 음수. 새 id만 출력 |
| `list [--month YYYY-MM] [--category 이름]` | 날짜 오름차순(같으면 id 오름차순), 한 줄에 `id<TAB>date<TAB>amount<TAB>category<TAB>memo` |
| `delete <id>` | 항목 삭제. 없는 id면 오류 |
| `report --month YYYY-MM` | 그 달 카테고리별 합계를 합계 오름차순(같으면 이름순)으로 `category<TAB>sum`, 마지막 줄 `TOTAL<TAB>합계` |
| `import <csv>` | 헤더 `date,amount,category,memo`. 잘못된 줄은 건너뛰고 stderr에 `line N: 이유`(헤더가 1번 줄), 마지막에 stdout으로 `imported X skipped Y` |

- 데이터는 `--db` JSON 파일에 저장하고, 파일(과 상위 폴더)이 없으면 새로 만듭니다. 임시 파일을 쓴 뒤 교체하므로 저장 중 실패해도 기존 파일이 깨지지 않습니다.
- id는 1부터 증가하며 삭제된 id는 다시 쓰지 않습니다.
- 종료 코드: 성공 0 · 잘못된 입력 2(날짜 형식이 틀리거나 없는 날짜, 정수가 아닌 금액, 빈 카테고리, 없는 id, 알 수 없는 명령, 읽을 수 없는 CSV나 틀린 헤더) · DB 파일을 읽거나 쓸 수 없거나 손상됨 1(파일은 건드리지 않음).
- `import`는 잘못된 줄이 있어도 종료 코드 0입니다. CSV는 UTF-8(BOM 허용)이며, 빈 줄은 무시하고, 따옴표 안 줄바꿈으로 여러 줄에 걸친 행은 첫 줄 번호로 보고합니다.
- 출력 형식을 지키기 위해 카테고리·메모 안의 탭과 줄바꿈은 공백으로 저장합니다.
- `-`로 시작하는 메모는 `--` 뒤에 씁니다: `add 2024-03-05 -1000 기타 -- -메모`.

## 테스트

```sh
python3 -m unittest -v
```
