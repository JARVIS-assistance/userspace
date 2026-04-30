#!/usr/bin/env bash
# 사용:  TOKEN="<localStorage에서 복사한 jarvis_token>" bash scripts/diagnose_auth.sh
#
# /auth/me와 /conversation/stream에 동일 토큰을 보내서
# 어느 쪽이 401을 내는지, 어떤 메시지인지 비교한다.

set -u
: "${TOKEN:?Set TOKEN env var first.   TOKEN=<jwt> bash $0}"

BASE="${BASE:-http://localhost:8001}"

echo "============================================================"
echo "  BASE = $BASE"
echo "  TOKEN(앞 24자) = ${TOKEN:0:24}..."
echo "============================================================"

echo
echo "── [1] GET /auth/me ──"
curl -s -o /tmp/jarvis_authme.json -w "  status=%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/auth/me"
echo "  body=$(cat /tmp/jarvis_authme.json)"

echo
echo "── [2] POST /conversation/stream (3초만 받고 끊음) ──"
curl -s -o /tmp/jarvis_stream.txt -w "  status=%{http_code}\n" \
  --max-time 3 \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"message":"hello"}' \
  "$BASE/conversation/stream" || true
echo "  body(앞 400자)="
head -c 400 /tmp/jarvis_stream.txt
echo
echo

echo "── [3] JWT payload(만료시각/audience 등) ──"
PAYLOAD=$(echo "$TOKEN" | cut -d. -f2)
# base64 padding 보정
MOD=$(( ${#PAYLOAD} % 4 ))
[ $MOD -ne 0 ] && PAYLOAD="${PAYLOAD}$(printf '=%.0s' $(seq 1 $((4-MOD))))"
echo "$PAYLOAD" | base64 -d 2>/dev/null | python3 -m json.tool 2>/dev/null \
  || echo "  (decode 실패 — 표준 JWT 아닐 수 있음)"
