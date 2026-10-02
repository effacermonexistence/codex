# Python 가계부 CLI

Python 3.9 이상, 표준 라이브러리만 사용합니다. 금액 단위는 원이며 지출은 음수입니다.

```sh
python3 ledger.py --db ledger.json add 2026-10-01 -12000 식비 "점심"
python3 ledger.py --db ledger.json list --month 2026-10 --category 식비
python3 ledger.py --db ledger.json report --month 2026-10
python3 ledger.py --db ledger.json delete 1
python3 ledger.py --db ledger.json import transactions.csv
python3 -B -m unittest -v
```

DB가 없으면 생성합니다. JSON의 `next_id`를 별도로 저장하므로 삭제된 ID는 재사용하지 않습니다. 저장은 임시 파일 작성 후 교체 방식이며, 손상된 기존 DB는 오류로 처리하고 덮어쓰지 않습니다.

CSV 헤더는 `date,amount,category,memo`입니다. 잘못된 데이터 기록은 건너뛰고 stderr에 `line N: 이유`를 출력합니다. N은 기록이 시작한 실제 파일 줄 번호(헤더 1)입니다. 따옴표로 감싼 쉼표·여러 줄 메모도 지원합니다. TSV 출력에서는 탭·줄바꿈을 `\t`, `\r`, `\n`으로 표시하여 기록당 한 줄을 유지하며 일반 역슬래시는 그대로 출력합니다.

성공 종료코드는 0, 잘못된 입력과 파일 오류는 2입니다. `add`는 ID만, `import`는 `imported X skipped Y`만 stdout에 출력하며, `delete`는 성공 시 출력하지 않습니다.
