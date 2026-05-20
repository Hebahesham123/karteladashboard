#!/bin/bash
# Create Supabase auth users for every salesperson with user_id = NULL.
set -u
SUPA_URL="https://cjazlcqmmcducwvzyoff.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqYXpsY3FtbWNkdWN3dnp5b2ZmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDM5MzA1NSwiZXhwIjoyMDg5OTY5MDU1fQ.6IRBjUdBq12tPLSKLTjgLsGoL97aF_xF6Oa005tdT34"

ROWS=$(curl -sS -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}" \
  "${SUPA_URL}/rest/v1/salespersons?select=id,code,name&user_id=is.null&order=code.asc" \
  --max-time 30 \
  | python -c '
import json,sys
for r in json.load(sys.stdin):
    code=(r.get("code") or "").strip()
    name=(r.get("name") or "").strip()
    rid=r["id"]
    if not code: continue
    print("\t".join([rid, code, name]))')

TOTAL=$(printf "%s\n" "$ROWS" | grep -c .)
echo "Will create $TOTAL accounts..."
echo

created=0; linked=0; failed=0; idx=0
while IFS=$'\t' read -r SP_ID CODE NAME; do
  [ -z "$SP_ID" ] && continue
  idx=$((idx+1))
  EMAIL=$(echo "$CODE" | tr '[:upper:]' '[:lower:]' | tr -dc 'a-z0-9')@gmail.com

  AUTH_PAYLOAD=$(python -c "import json,sys; print(json.dumps({'email':sys.argv[1],'password':'123456','email_confirm':True,'user_metadata':{'full_name':sys.argv[2],'role':'sales'}}))" "$EMAIL" "$NAME")

  AUTH_RES=$(curl -sS -X POST \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    "${SUPA_URL}/auth/v1/admin/users" \
    -d "$AUTH_PAYLOAD" \
    --max-time 20)

  USR_ID=$(echo "$AUTH_RES" | python -c 'import json,sys
try:
  d=json.load(sys.stdin)
  print(d.get("id") or "")
except Exception:
  print("")' 2>/dev/null)

  STATUS=""
  if [ -z "$USR_ID" ]; then
    USER_LIST=$(curl -sS -G \
      -H "apikey: ${SERVICE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_KEY}" \
      --data-urlencode "filter=email.eq.${EMAIL}" \
      --data-urlencode "per_page=1" \
      "${SUPA_URL}/auth/v1/admin/users" --max-time 15)
    USR_ID=$(echo "$USER_LIST" | python -c 'import json,sys
try:
  d=json.load(sys.stdin); us=d.get("users",[])
  print(us[0]["id"] if us else "")
except Exception:
  print("")' 2>/dev/null)
    if [ -n "$USR_ID" ]; then
      STATUS="linked-existing"
    else
      ERR_MSG=$(echo "$AUTH_RES" | head -c 200 | tr -d '\n')
      printf "%3d/%d  X %-12s  fail: %s\n" "$idx" "$TOTAL" "$CODE" "$ERR_MSG"
      failed=$((failed+1))
      continue
    fi
  else
    STATUS="created"
  fi

  USERS_PAYLOAD=$(python -c "import json,sys; print(json.dumps([{'id':sys.argv[1],'email':sys.argv[2],'full_name':sys.argv[3],'role':'sales','is_active':True}]))" "$USR_ID" "$EMAIL" "$NAME")
  curl -sS -X POST \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    "${SUPA_URL}/rest/v1/users" \
    -d "$USERS_PAYLOAD" --max-time 15 >/dev/null

  curl -sS -X PATCH \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    "${SUPA_URL}/rest/v1/salespersons?id=eq.${SP_ID}" \
    -d "{\"user_id\":\"$USR_ID\"}" --max-time 15 >/dev/null

  if [ "$STATUS" = "created" ]; then
    printf "%3d/%d  + %-12s  %s\n" "$idx" "$TOTAL" "$CODE" "$EMAIL"
    created=$((created+1))
  else
    printf "%3d/%d  > %-12s  %s\n" "$idx" "$TOTAL" "$CODE" "$EMAIL"
    linked=$((linked+1))
  fi
done <<< "$ROWS"

echo
echo "Done: created=$created  linked=$linked  failed=$failed  total=$TOTAL"
