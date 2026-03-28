# 테니스 클럽 관리 웹

작은 규모 테니스 클럽의 **순위**, **대진**, **경기 결과**, **개인별/상대별 승률**을 관리하는 모바일 친화 웹앱입니다.

---

## 요구 사항

- Node.js 18 이상
- MariaDB 10.6 이상
- PM2 (운영 서버)

---

## 로컬 개발 실행

```bash
npm install
# ecosystem.config.js 생성 후 (아래 참조)
node server.js
```

---

## 배포 (운영 서버)

### 최초 배포

```bash
# 1. 레포 클론
git clone https://github.com/<your-org>/tennis-club.git
cd tennis-club

# 2. 의존성 설치
npm install --omit=dev

# 3. PM2 설정 파일 생성 (크레덴셜 직접 입력)
cp ecosystem.config.js.example ecosystem.config.js
vi ecosystem.config.js   # DB_HOST, DB_PASSWORD 실제 값으로 수정

# 4. PM2로 서비스 등록 및 시작
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # 서버 재부팅 시 자동 시작 등록
```

### 이후 업데이트 배포

```bash
bash deploy.sh
```

> `deploy.sh` 는 `git pull → npm install → pm2 reload` 를 순서대로 실행합니다.

---

## 환경변수 (ecosystem.config.js)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `DB_HOST` | `localhost` | MariaDB 호스트 |
| `DB_PORT` | `3306` | MariaDB 포트 |
| `DB_USER` | `root` | DB 사용자 |
| `DB_PASSWORD` | _(없음)_ | DB 비밀번호 — **반드시 설정** |
| `DB_NAME` | `tennis_club` | DB 이름 |

> `ecosystem.config.js` 는 크레덴셜을 포함하므로 `.gitignore` 에 포함되어 있습니다.
> 절대 git 에 커밋하지 마세요.

---

## 클라이언트 API 설정

`config.js` 의 `TENNIS_API_BASE` 에 API 서버 주소를 설정합니다.

```js
// 같은 서버에서 서빙하는 경우 빈 값 유지
window.TENNIS_API_BASE = '';

// 별도 서버인 경우
window.TENNIS_API_BASE = 'http://192.168.20.27:3000';
```

---

## 게임 구성 방식

| 구분 | 방식 | 설명 |
|---|---|---|
| 게임 1~3 | 그룹 기반 | 점수 상위 절반(A) / 하위 절반(B) 분리 후 매칭 |
| 게임 4 | 전체 교차 | [1위+꼴찌] vs [2위+2꼴찌] ... |
| 게임 5 | Shifted 교차 | [1위+2꼴찌] vs [2위+3꼴찌] ..., 4게임 대기자 복귀 보장 |

자세한 내용은 `메뉴얼.md` 참조.

---

## DB 마이그레이션

DB 스키마 변경이 필요한 경우에만 `migrate-db.sh` 를 사용합니다.
(`migrate-db.sh` 는 `.gitignore` 에 포함되어 있으며 git 관리 대상이 아닙니다.)
