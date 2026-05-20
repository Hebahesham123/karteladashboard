#!/bin/bash
# Link existing auth users to salespersons that still have user_id = NULL.
# Run this AFTER create_sales_users.sh has done as much as it can.
set -u
SUPA_URL="https://cjazlcqmmcducwvzyoff.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqYXpsY3FtbWNkdWN3dnp5b2ZmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDM5MzA1NSwiZXhwIjoyMDg5OTY5MDU1fQ.6IRBjUdBq12tPLSKLTjgLsGoL97aF_xF6Oa005tdT34"

echo "Building email → user_id map from auth.users (paginated)..."
EMAILS_FILE=$(mktemp)
PAGE=1
while [ $PAGE -le 50 ]; do
  RES=$(curl -sS -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}" \
    "${SUPA_URL}/auth/v1/admin/users?page=${PAGE}&per_page=1000" --max-time 30)
  COUNT=$(echo "$RES" | python -c '
import json,sys
try:
  d=json.load(sys.stdin); us=d.get("users",[])
  for u in us:
    e=(u.get("email") or "").lower().strip()
    i=u.get("id") or ""
    if e and i:
      print(e + "\t" + i)
  print("===EOF===", file=sys.stderr)
  print(len(us), file=sys.stderr)
except Exception as ex:
  print(0, file=sys.stderr)
' 2>&1 >> "$EMAILS_FILE")
  LAST_LEN=$(echo "$RES" | python -c '
import json,sys
try:
  d=json.load(sys.stdin); us=d.get("users",[])
  print(len(us))
except Exception:
  print(0)
')
  echo "  page $PAGE: $LAST_LEN users"
  if [ "$LAST_LEN" -lt 1000 ]; then break; fi
  PAGE=$((PAGE+1))
done

# Remove the "===EOF===" stderr noise from the file
grep -v "===EOF===" "$EMAILS_FILE" > "${EMAILS_FILE}.clean"
mv "${EMAILS_FILE}.clean" "$EMAILS_FILE"

TOTAL_USERS=$(wc -l < "$EMAILS_FILE")
echo "Total auth users found: $TOTAL_USERS"
echo

# Get unlinked salespersons
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
echo "Will try to link $TOTAL unlinked salespersons..."
echo

linked=0; created=0; skipped_invalid=0; failed=0; idx=0
while IFS=$'\t' read -r SP_ID CODE NAME; do
  [ -z "$SP_ID" ] && continue
  idx=$((idx+1))
  # Build email candidate. Strip non-ASCII (lowercase, only [a-z0-9]).
  EMAIL_LOCAL=$(echo "$CODE" | tr '[:upper:]' '[:lower:]' | tr -dc 'a-z0-9')
  if [ -z "$EMAIL_LOCAL" ]; then
    printf "%3d/%d  -- %-30s  skipped (code has no ASCII chars)\n" "$idx" "$TOTAL" "$CODE"
    skipped_invalid=$((skipped_invalid+1))
    continue
  fi
  EMAIL="${EMAIL_LOCAL}@gmail.com"

  # Look up in map
  USR_ID=$(grep -m1 "^${EMAIL}	" "$EMAILS_FILE" | cut -f2)

  if [ -z "$USR_ID" ]; then
    # No existing user → create one
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
  print(json.load(sys.stdin).get("id") or "")
except: print("")')
    if [ -z "$USR_ID" ]; then
      ERR=$(echo "$AUTH_RES" | head -c 150 | tr -d '\n')
      printf "%3d/%d  XX %-12s  create-fail: %s\n" "$idx" "$TOTAL" "$CODE" "$ERR"
      failed=$((failed+1))
      continue
    fi
    created=$((created+1))
    STATUS="+"
  else
    linked=$((linked+1))
    STATUS=">"
  fi

  # Upsert public.users
  USERS_PAYLOAD=$(python -c "import json,sys; print(json.dumps([{'id':sys.argv[1],'email':sys.argv[2],'full_name':sys.argv[3],'role':'sales','is_active':True}]))" "$USR_ID" "$EMAIL" "$NAME")
  curl -sS -X POST \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    "${SUPA_URL}/rest/v1/users" \
    -d "$USERS_PAYLOAD" --max-time 15 >/dev/null

  # Link salesperson
  curl -sS -X PATCH \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    "${SUPA_URL}/rest/v1/salespersons?id=eq.${SP_ID}" \
    -d "{\"user_id\":\"$USR_ID\"}" --max-time 15 >/dev/null

  printf "%3d/%d  %s %-12s  %s\n" "$idx" "$TOTAL" "$STATUS" "$CODE" "$EMAIL"
done <<< "$ROWS"

rm -f "$EMAILS_FILE"
echo
echo "Done: created=$created  linked=$linked  skipped_invalid=$skipped_invalid  failed=$failed  total=$TOTAL"
