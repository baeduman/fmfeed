# fmfeed — 에펨코리아 미스터리/공포 RSS

GitHub Actions가 30분 주기로 펨코 `mystery` 게시판 목록을 크롤해 `feed.xml`을 생성·커밋하고,
GitHub Pages(/main)가 서빙합니다.

- 피드 URL: `https://baeduman.github.io/fmfeed/feed.xml`
- 크롤 우회: 1) Node fetch (브라우저 헤더) → 2) 430 시 Playwright chromium (보안 시스템 자동 통과 대기)

## 수동 실행
- GitHub repo → Actions → fmfeed → Run workflow

## 디버그 (로컬)
```bash
cd scraper
npm install
npx playwright install chromium
node scraper.mjs              # fetch 경로
FORCE_BROWSER=1 node scraper.mjs   # 브라우저 경로 강제
node scraper.mjs --headed     # headed (xvfb 필요한 환경용)
```

환경변수: `INCLUDE_NOTICE=1` 공지 포함
