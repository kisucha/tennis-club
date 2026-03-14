# GitHub에 테니스 클럽 프로젝트 저장하기

## 1. 준비

- **Git**이 설치되어 있어야 합니다.  
  설치: https://git-scm.com/download/win  
- **GitHub 계정**이 있어야 합니다.  
  가입: https://github.com/join  

---

## 2. GitHub에 새 저장소 만들기

1. https://github.com 로그인
2. 오른쪽 상단 **+** → **New repository**
3. **Repository name**: 예) `tennis-club`
4. **Public** 선택
5. **Create repository** 클릭 (README, .gitignore 추가 안 해도 됨)

---

## 3. 프로젝트 폴더에서 Git 초기화 및 푸시

**PowerShell 또는 명령 프롬프트**에서 프로젝트 폴더로 이동한 뒤 아래를 순서대로 실행하세요.

```powershell
cd c:\Users\kisuc\OneDrive\Desktop\test\tennis
```

### 처음 한 번만 (저장소 연결)

```powershell
git init
git add .
git commit -m "테니스 클럽 관리 앱 초기 버전"
```

GitHub에서 만든 저장소 주소를 사용합니다.  
예: `https://github.com/내아이디/tennis-club.git`

```powershell
git remote add origin https://github.com/내아이디/tennis-club.git
git branch -M main
git push -u origin main
```

- **내아이디** 부분을 본인 GitHub 아이디로 바꾸세요.
- 로그인 창이 뜨면 GitHub 계정으로 로그인하거나, **Personal Access Token**을 비밀번호 대신 입력합니다.

---

## 4. 데이터 파일(data/tennis.json) 포함 여부

- **포함하려면**:  
  `.gitignore`에 `data/`를 넣지 않으면 `data/tennis.json`도 함께 커밋·푸시됩니다.  
  → GitHub에 올라간 데이터를 다른 사람이 clone해서 그대로 쓸 수 있습니다.

- **제외하려면** (데이터는 로컬/서버에만 두고 코드만 올리려면):  
  `.gitignore`에 다음 한 줄을 추가하세요.  
  ```
  data/
  ```

지금은 **데이터도 함께 올리려면** `.gitignore`에 `data/`를 넣지 않으면 됩니다.

---

## 5. 나중에 수정한 내용 다시 올리기

코드나 데이터를 수정한 뒤, 아래만 반복하면 됩니다.

```powershell
cd c:\Users\kisuc\OneDrive\Desktop\test\tennis
git add .
git commit -m "수정 내용 한 줄 요약"
git push
```

---

## 6. 다른 PC에서 사용하려면

다른 컴퓨터에서:

```powershell
git clone https://github.com/내아이디/tennis-club.git
cd tennis-club
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속하면, GitHub에 올려둔 코드와 `data/tennis.json`(포함한 경우)으로 동일하게 사용할 수 있습니다.

---

## 7. Personal Access Token (푸시 시 비밀번호 대신)

GitHub에서 비밀번호로 푸시가 안 되면 토큰을 씁니다.

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens**
2. **Generate new token** → 이름 입력, **repo** 권한 체크
3. 생성된 토큰을 복사해 두고, `git push` 할 때 **비밀번호 입력하는 자리에 이 토큰**을 붙여넣습니다.

---

요약: **가능합니다.** 위 순서대로 하면 프로젝트와 (원하면) `data/tennis.json`까지 GitHub에 저장하고, 다른 사람이나 다른 PC와 공유할 수 있습니다.
