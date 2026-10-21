#!/usr/bin/env bash
# /test 개발 인스턴스 관리 — 본체 dev 만 다룬다(설치본·단독판 lite 는 건드리지 않는다).
#
#   dev.sh status          떠 있는 것·누가 띄웠나·디버깅 포트 연결·dev 터미널 세션·설치본 생존
#   dev.sh up <로그파일>    dev 를 디버깅 포트로 띄운다 — Bash run_in_background 로 부를 것(dev 가 끝날 때까지 붙어 있다)
#   dev.sh wait            디버깅 포트 + 메인 창 페이지가 뜰 때까지 기다린다(최대 90초)
#   dev.sh down            포트가 빌 때까지 TERM → KILL, 설치본이 살아 있는지 확인
#
# up 은 dev 를 사용자 GUI(Aqua) 세션의 LaunchAgent 로 띄운다 — 이 셸이 launchd Background 세션(설치본 터미널의 tmux)이어도
# 창이 보이는 dev 가 뜨고, Terminal.app 창이 뜨지 않는다. Bash 로 npm start 를 직접 부르면 Background 세션이라 창이 안 보인다.
#
# ⚠️ 이미 떠 있는 dev 는 다른 세션·사용자의 것일 수 있다 — up 은 거부하고, down 은 status 로 확인한 뒤에만.
set -u
ROOT=/Users/sbjung/coding/one-app
PORT=${TEST_PORT:-9333}
MO_PORT=18318
DOMAIN="gui/$(id -u)"
LABEL=com.oneapp.dev-test
# 본체 dev Electron 메인 프로세스 — lite 는 경로가 coding/one-app/standalone/lite/… 라 안 걸린다
DEV_EL='coding/one-app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
INSTALLED='/Applications/One App.app/Contents/MacOS/One App'
SIDECAR="$HOME/Library/Application Support/One App/terminal-sessions-dev.json"

el_pids() { pgrep -f "$DEV_EL" || true; }
# electron-forge start 는 lite 도 같은 명령이다 — 작업 폴더가 본체 루트인 것만 고른다
forge_pids() {
  local p
  for p in $(pgrep -f 'electron-forge start' || true); do
    [ "$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$ROOT" ] && echo "$p"
  done
}
port_pid() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1; }
installed_alive() { pgrep -f "$INSTALLED" >/dev/null; }
job_loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }
job_running() { launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q 'state = running'; }

status() {
  local els forges pp
  els=$(el_pids); forges=$(forge_pids); pp=$(port_pid)
  if [ -z "$els" ]; then
    echo "dev: 없음"
  else
    for p in $els; do
      local term
      term=$(ps eww -o command= -p "$p" 2>/dev/null | tr ' ' '\n' | sed -nE 's/^(ONEAPP_DEV_BY|TERM_PROGRAM)=//p' | head -1)
      echo "dev: Electron pid $p · 시작 $(ps -o lstart= -p "$p") · 띄운 곳 ${term:-?} (test-launchd=/test 의 dev.sh up, tmux=설치본 터미널의 Claude 쪽, Apple_Terminal·iTerm.app=사용자)"
    done
  fi
  [ -n "$forges" ] && echo "forge: pid $(echo $forges)"
  if [ -n "$pp" ]; then
    local owner=타프로세스
    echo " $els " | grep -q " $pp " && owner=dev
    echo "디버깅 포트 $PORT: LISTEN (pid $pp · $owner)"
    local conns
    conns=$(lsof -nP -iTCP:"$PORT" -sTCP:ESTABLISHED 2>/dev/null | awk 'NR>1 && $2!='"$pp"' {print $1"("$2")"}' | sort -u | tr '\n' ' ')
    [ -n "$conns" ] && echo "  ⚠️ 붙어 있는 클라이언트: $conns← 다른 세션이 테스트 중일 수 있다"
  else
    [ -n "$els" ] && echo "디버깅 포트 $PORT: 닫힘 ← 포트 없이 뜬 dev (붙는 법: reference/recipes.md 'SIGUSR1')"
  fi
  lsof -nP -iTCP:"$MO_PORT" -sTCP:LISTEN -t >/dev/null 2>&1 && echo "MO dev 포트 $MO_PORT: LISTEN"
  echo "dev tmux 세션:"
  tmux -L oneapp-dev list-sessions -F '  #{session_name} · attached=#{session_attached} · 생성 #{t:session_created}' 2>/dev/null \
    || echo "  (tmux 서버 없음)"
  if [ -f "$SIDECAR" ]; then
    python3 -I - "$SIDECAR" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
if d:
    print("dev 세션 sidecar (재부팅 뒤 resume 있는 것은 claude --resume 으로 되살아난다):")
    for k, v in d.items():
        print(f"  {k} · {v.get('title')} · {v.get('agentId')} · resume={'있음' if v.get('resume') else '없음'}")
PY
  fi
  job_loaded && echo "launchd job $DOMAIN/$LABEL: $(job_running && echo 실행 중 || echo '등록만 남음(끝남)')"
  installed_alive && echo "설치본: 살아 있음" || echo "설치본: 꺼져 있음"
  [ "$(launchctl managername 2>/dev/null)" = Background ] &&
    echo "셸: launchd Background 세션 — dev 는 dev.sh up 으로만 띄울 것(npm start 를 직접 부르면 창이 안 보인다)"
  return 0
}

case "${1:-status}" in
  status) status ;;

  up)
    LOG=${2:?로그 파일 경로가 필요하다 — 스크래치패드에}
    if [ -n "$(el_pids)$(forge_pids)" ]; then
      echo "⛔ 이미 떠 있다 — 재사용하거나, 재시작이 필요하면 사용자에게 묻는다"; status; exit 3
    fi
    if [ -n "$(port_pid)" ]; then
      echo "⛔ 디버깅 포트 $PORT 를 다른 프로세스가 쥐고 있다(pid $(port_pid))"; exit 3
    fi
    # 지난 기동의 등록이 남아 있으면 bootstrap 이 거부한다(이미 끝난 job — 위에서 떠 있는 dev 는 걸렀다)
    job_loaded && launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    PLIST="$(dirname "$LOG")/$LABEL.plist"
    : >"$LOG"   # launchd 는 로그를 이어 쓴다 — 지난 기동 로그와 섞이지 않게 비운다
    # launchd 환경엔 PATH 가 최소라 node(volta)·tmux 를 못 찾는다 — 이 셸의 것을 넘긴다
    # `--` 두 번 — 앱 인자로 넘어가야 Chromium 이 파싱한다
    python3 -I - "$PLIST" "$LABEL" "$ROOT" "$LOG" "$(command -v npm)" "$PORT" <<'PY' || exit 1
import os, plistlib, sys
plist, label, root, log, npm, port = sys.argv[1:]
env = {k: os.environ[k] for k in ('PATH', 'LANG', 'SHELL', 'VOLTA_HOME') if k in os.environ}
env['ONEAPP_DEV_BY'] = 'test-launchd'   # status 의 "띄운 곳"
with open(plist, 'wb') as f:
    plistlib.dump({
        'Label': label,
        'ProgramArguments': [npm, 'start', '--', '--', f'--remote-debugging-port={port}'],
        'WorkingDirectory': root,
        'EnvironmentVariables': env,
        'StandardOutPath': log,
        'StandardErrorPath': log,
        'RunAtLoad': True,
        'ProcessType': 'Interactive',   # 앱처럼 — 백그라운드 스로틀을 받지 않게
    }, f)
PY
    launchctl bootstrap "$DOMAIN" "$PLIST" || { echo "⛔ launchctl bootstrap 실패"; exit 1; }
    echo "기동: npm start -- -- --remote-debugging-port=$PORT (launchd $DOMAIN/$LABEL) → $LOG"
    # run_in_background 작업을 멈추면 dev 도 같이 내린다 — job 을 내리면 launchd 가 프로세스 그룹(forge·Electron)까지 정리한다
    trap 'launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null; exit 143' TERM INT HUP
    for i in $(seq 1 10); do job_running && break; sleep 0.5; done
    # dev 가 끝날 때까지 붙어 있는다 — run_in_background 의 종료 알림으로 dev 가 죽은 걸 안다
    while job_running; do sleep 1; done
    code=$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -m1 'last exit code' | sed 's/^[[:space:]]*//')
    echo "dev 종료 · ${code:-job 이 바깥에서 내려짐(dev.sh down 등)}"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    exit 0
    ;;

  wait)
    SECONDS=0
    while [ "$SECONDS" -lt 90 ]; do
      if [ -n "$(port_pid)" ] && curl -s "http://127.0.0.1:$PORT/json/list" | grep -q '"url": *"http://localhost:'; then
        pp=$(port_pid)
        if echo " $(el_pids | tr '\n' ' ') " | grep -q " $pp "; then
          echo "✅ 준비됨 (${SECONDS}초 대기) · Electron pid $pp · 시작 $(ps -o lstart= -p "$pp")"; exit 0
        fi
        echo "⛔ 포트 $PORT 를 dev 가 아닌 프로세스(pid $pp)가 쥐고 있다 — 옛 고아일 수 있다: dev.sh down 후 다시"; exit 2
      fi
      sleep 0.5
    done
    echo "⛔ 90초 안에 안 떴다 — 로그를 볼 것"; exit 1
    ;;

  down)
    # dev.sh up 으로 띄운 것 — job 을 내리면 launchd 가 TERM 후 프로세스 그룹까지 정리한다. 남은 것은 아래에서
    job_loaded && launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    targets="$(forge_pids) $(el_pids)"
    if [ -z "${targets// /}" ]; then echo "내릴 dev 없음"; else
      # forge 만 죽이면 Electron 이 고아로 남아 포트를 쥔다 — 둘 다 보낸다
      kill $targets 2>/dev/null
      for i in $(seq 1 20); do
        [ -z "$(el_pids)$(forge_pids)" ] && [ -z "$(port_pid)" ] && break
        sleep 0.5
      done
      if [ -n "$(el_pids)$(forge_pids)" ]; then
        echo "10초 뒤에도 남음 → KILL: $(el_pids) $(forge_pids)"
        kill -9 $(el_pids) $(forge_pids) 2>/dev/null; sleep 1
      fi
    fi
    left="$(el_pids)$(forge_pids)$(port_pid)"
    [ -z "$left" ] && echo "✅ dev 내려감 · 포트 $PORT 비어 있음" || echo "⛔ 남음: el=$(el_pids) forge=$(forge_pids) port=$(port_pid)"
    installed_alive && echo "✅ 설치본 살아 있음" || echo "⚠️ 설치본이 꺼져 있다 — 원래 꺼져 있었는지 확인"
    [ -z "$left" ]
    ;;

  *) echo "사용법: dev.sh status | up <로그> | wait | down"; exit 1 ;;
esac
