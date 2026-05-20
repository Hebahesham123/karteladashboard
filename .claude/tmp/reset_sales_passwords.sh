#!/bin/bash
# Reset every linked sales user's password to 123456.
set -u
SUPA_URL="https://cjazlcqmmcducwvzyoff.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqYXpsY3FtbWNkdWN3dnp5b2ZmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDM5MzA1NSwiZXhwIjoyMDg5OTY5MDU1fQ.6IRBjUdBq12tPLSKLTjgLsGoL97aF_xF6Oa005tdT34"

# Pull every salesperson that DOES have a linked user_id.
ROWS=$(curl -sS -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}" \
  "${SUPA_URL}/rest/v1/salespersons?select=code,user_id&user_id=not.is.null&order=code.asc" \
  --max-time 30 \
  | python -c '
import json,sys
for r in json.load(sys.stdin):
    code=(r.get("code") or "").strip()
    uid=r.get("user_id")
    if not code or not uid: continue
    print(code + "\t" + uid)')

TOTAL=$(printf "%s\n" "$ROWS" | grep -c .)
echo "Will reset password for $TOTAL sales users..."
echo

ok=0; failed=0; idx=0
while IFS=$'\t' read -r CODE USR_ID; do
  # Strip any trailing whitespace (CR from Windows-style line endings, etc.)
  USR_ID=$(echo "$USR_ID" | tr -d '\r\n ')
  CODE=$(echo "$CODE" | tr -d '\r')
  [ -z "$USR_ID" ] && continue
  idx=$((idx+1))
  RES=$(curl -sS -X PUT \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    "${SUPA_URL}/auth/v1/admin/users/${USR_ID}" \
    -d '{"password":"123456"}' --max-time 15)
  OK_ID=$(echo "$RES" | python -c 'import json,sys
try:
  print(json.load(sys.stdin).get("id") or "")
except: print("")')
  if [ -n "$OK_ID" ]; then
    ok=$((ok+1))
    if [ $((idx % 20)) -eq 0 ]; then echo "  $idx/$TOTAL done..."; fi
  else
    ERR=$(echo "$RES" | head -c 150 | tr -d '\n')
    printf "%3d/%d  X %-12s  %s\n" "$idx" "$TOTAL" "$CODE" "$ERR"
    failed=$((failed+1))
  fi
done <<< "$ROWS"

echo
echo "Done: ok=$ok  failed=$failed  total=$TOTAL"
