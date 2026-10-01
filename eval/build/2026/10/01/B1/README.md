# 파이썬 가계부 CLI

Python 3.9 이상과 표준 라이브러리만 사용합니다.

```sh
python3 ledger.py --db ledger.json add 2026-10-01 -12000 식비 "점심"
python3 ledger.py --db ledger.json list --month 2026-10 --category 식비
python3 ledger.py --db ledger.json report --month 2026-10
python3 ledger.py --db ledger.json delete 1
python3 ledger.py --db ledger.json import transactions.csv
python3 -B -m unittest -v
```

- 메모는 선택이며, 공백이 포함되면 따옴표로 감쌉니다.
- 날짜는 실제 존재하는 `YYYY-MM-DD`, 월은 `YYYY-MM`, 금액은 부호를 허용하는 정수입니다. 카테고리의 양끝 공백은 제거하며 빈 카테고리는 거부합니다.
- CSV 헤더는 `date,amount,category,memo`입니다. UTF-8(BOM 포함)을 읽고, 잘못된 레코드는 건너뛰며 시작 줄 번호와 이유를 stderr에 출력합니다. 따옴표로 감싼 쉼표·줄바꿈은 CSV 규칙에 따라 읽습니다.
- 한 항목을 한 줄에 출력하기 위해 TSV 텍스트 필드의 실제 탭·CR·LF는 각각 `\t`·`\r`·`\n`으로 표시합니다. JSON에는 원문을 보존합니다.
- JSON에 `next_id`와 `entries`를 저장합니다. 삭제된 id는 재사용하지 않습니다. DB 파일이 없으면 생성하되 부모 디렉터리는 미리 존재해야 합니다.
- 저장은 같은 디렉터리의 임시 파일을 통한 원자적 교체입니다. 손상된 기존 DB는 덮어쓰지 않습니다. 동시에 여러 쓰기 프로세스를 실행하는 용도는 아닙니다.
- `add`는 새 id만, `delete`는 아무것도 출력하지 않습니다. 입력 오류는 stderr 메시지와 종료코드 `2`를 반환합니다.
