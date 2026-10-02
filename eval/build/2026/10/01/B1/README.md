# 가계부 CLI

Python 3 표준 라이브러리만 사용합니다. 별도 설치가 필요 없습니다.

```sh
python3 ledger.py --db ledger.json add 2026-10-01 -12000 식비 "점심"
python3 ledger.py --db ledger.json list --month 2026-10 --category 식비
python3 ledger.py --db ledger.json report --month 2026-10
python3 ledger.py --db ledger.json delete 1
python3 ledger.py --db ledger.json import entries.csv
python3 -m unittest discover -v
```

- `--db` 파일이 없으면 정상 명령 실행 시 생성합니다. 상위 폴더는 존재해야 합니다.
- JSON은 `next_id`와 `entries`를 저장합니다. 삭제 후에도 `next_id`를 유지하여 ID를 재사용하지 않습니다.
- 추가 성공 시 새 ID만, 삭제 성공 시 아무것도 출력하지 않습니다.
- 잘못된 명령/입력, 손상된 DB, 파일 접근 오류는 stderr 메시지와 종료코드 `2`를 반환합니다.
- 변경은 같은 폴더의 임시 파일을 작성한 뒤 원자적으로 교체합니다. 단일 프로세스 실행용이며 동시 쓰기 잠금은 제공하지 않습니다.

## CSV

UTF-8 CSV(선택적 BOM)의 헤더는 정확히 `date,amount,category,memo`입니다.

```csv
date,amount,category,memo
2026-10-01,-12000,식비,점심
2026-10-02,3000000,급여,10월 급여
```

잘못된 날짜·금액·빈 카테고리·열 개수·CSV 구문은 건너뛰고 `line N: 이유`를 stderr에 출력합니다. `N`은 CSV 레코드가 시작하는 실제 파일 줄 번호이며, 첫 데이터 줄은 `2`입니다. 마지막 stdout은 `imported X skipped Y`입니다. 따옴표로 감싼 쉼표와 여러 줄 메모도 읽습니다. 닫히지 않은 따옴표가 파일 끝까지 이어지면 그 전체 레코드를 한 건으로 건너뜁니다.

`list`와 `report`의 문자열에 실제 탭·줄바꿈이 있으면 `\t`, `\r`, `\n`으로 표시하여 출력의 줄/필드 경계를 보존합니다. 금액은 부호가 붙을 수 있는 10진 정수이며, 금액 주변 공백은 허용합니다.
