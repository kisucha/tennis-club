# GitHub Pages에서 서버/API 없이 공유하기

> 현재 버전은 MariaDB 기반 서버 저장을 사용합니다.  
> GitHub Pages로 상태 파일을 공유하는 방식은 **레거시(참고용)** 입니다.

## 방식

- **서버나 API는 사용하지 않습니다.**
- 저장소에 **상태 파일 하나**(예: `data/state.json`)를 두고, **매 페이지 로드 시** 그 파일을 `fetch`로 불러와 사용합니다.
- PC·모바일 모두 같은 URL의 파일을 읽으므로 **같은 데이터**가 보입니다.

## 동작

1. **로드**: 페이지를 열 때마다 `config.js`에 지정한 경로(기본 `data/state.json`)를 `fetch`로 불러옵니다. 성공하면 그 내용으로 화면을 채우고, 실패하면 이 기기의 localStorage를 사용합니다.
2. **저장**: 편집 시에는 **항상 이 기기의 localStorage**에만 저장됩니다. 브라우저는 보안상 웹페이지가 사용자 PC나 GitHub 저장소의 파일을 직접 수정할 수 없습니다.
3. **공유 반영**: 변경 내용을 “모두가 보는 데이터”에 반영하려면  
   **「상태 파일로 저장 (state.json 다운로드)」** 버튼으로 파일을 받은 뒤, 저장소의 `data/state.json`을 이 파일로 **덮어쓰고 커밋·푸시**하면 됩니다. 그다음부터 다른 기기에서 새로고침하면 같은 내용을 봅니다.

## 설정

- `config.js`의 `TENNIS_STATE_FILE`에 불러올 파일 경로를 넣습니다.
  - 비우면 기본값 `data/state.json`을 사용합니다.
  - 상대 경로 예: `'data/state.json'` (GitHub Pages에서는 같은 저장소의 해당 파일을 불러옴)
  - 다른 저장소 파일을 쓰려면 전체 URL 예: `'https://raw.githubusercontent.com/사용자/저장소/main/data/state.json'`

## 요약

| 항목     | 설명 |
|----------|------|
| 로드     | 매 페이지 로드 시 `data/state.json`(또는 설정한 경로) fetch → 성공 시 그대로 사용, 실패 시 localStorage 사용 |
| 저장     | 이 기기 localStorage + 필요 시 「상태 파일로 저장」으로 다운로드한 뒤 저장소의 `data/state.json` 교체 후 푸시 |
| 서버/API | 사용하지 않음 |
