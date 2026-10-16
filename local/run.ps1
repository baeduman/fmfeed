# FMFeed 로컬 주기 실행 스크립트 (작업 스케줄러에 의해 호출됨)
# - 0~300초 랜덤 지터 후 크롤(빠른경로 fetch → 실패 시 Playwright)
# - feed.xml 변동 있을 때만 커밋+푸시 → GitHub Pages가 서빙
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location ..
$repo = Get-Location
$lockFile = Join-Path $repo 'local\.fmfeed.lock'
$logFile  = Join-Path $repo 'local\fmfeed.log'

function Log($msg) {
    $line = ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
    # 로그 1000줄 초과 시 앞부분 잘라냄
    if ((Get-Item $logFile -ErrorAction SilentlyContinue).Length -gt 200KB) {
        $tail = Get-Content -LiteralPath $logFile -Tail 300
        Set-Content -LiteralPath $logFile -Value $tail -Encoding UTF8
    }
}

# 중복 실행 방지 (락)
$lockStream = $null
try {
    $lockStream = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
    $lockStream = $null
}
if (-not $lockStream) { Log 'skip: another instance is running'; exit 0 }
try {
    $jitter = if ($env:FMFEED_NOJITTER -eq '1') { 0 } else { Get-Random -Minimum 0 -Maximum 301 }
    Log "start (jitter ${jitter}s)"
    Start-Sleep -Seconds $jitter

    git pull --ff-only 2>&1 | Out-Null

    node scraper/scraper.mjs *> (Join-Path $env:TEMP 'fmfeed_last.txt')
    $exit = $LASTEXITCODE
    $last = Get-Content (Join-Path $env:TEMP 'fmfeed_last.txt') -Raw -ErrorAction SilentlyContinue
    if ($exit -ne 0) {
        Log "crawl FAILED (exit=$exit): $((($last -split "`n") | Select-Object -Last 1))"
        exit 2
    }
    Log ($last.Trim() -replace "`r`n", ' | ' -replace "`n", ' | ')

    git add feed.xml
    $diff = git diff --cached --quiet; $changed = ($LASTEXITCODE -ne 0)
    if ($changed) {
        git commit -m "chore: update feed.xml (local) [skip ci]" | Out-Null
        git push 2>&1 | Out-Null
        Log 'pushed'
    } else {
        Log 'no feed changes'
    }
} finally {
    $lockStream.Close()
}
