#!/bin/sh
# Rebuilds the two RUN files in this folder from the source SQL files.
# Sources: ../batch-3-sql/04_*.sql (batch 3 features) and ../06_session_conference.sql.
cd "$(dirname "$0")"
SRC="../batch-3-sql/04_agenda.sql ../batch-3-sql/04_session_timing.sql ../batch-3-sql/04_abstract_books.sql ../batch-3-sql/04_feedback.sql"

part() { # $1 = database name
  for f in $SRC; do
    echo; echo "-- ---------- $(basename "$f") ($1) ----------"
    sed "s/\bconference_cms\b/$1/g" "$f"
  done
  echo; echo "-- ---------- 06_session_conference.sql ($1) ----------"
  echo "USE $1;"
  cat ../06_session_conference.sql
}

header() {
  echo "-- ====================================================================="
  echo "-- $1"
  echo "-- Built by build.sh on $(date +%Y-%m-%d). Everything here is safe to run"
  echo "-- more than once: tables/columns are only added when missing, nothing is"
  echo "-- deleted. Contents: My agenda, session timer, book of abstracts, feedback"
  echo "-- survey (batch 3) + sessions bound to one conference (06)."
  echo "-- ====================================================================="
  echo "SET NAMES utf8mb4;"
  echo "SET time_zone = '+00:00';"
}

{
  header "STEP 1 - YOUR COMPUTER: updates conference_cms AND conference_cms_test"
  echo; echo "-- ===================== PART 1: conference_cms ====================="
  part conference_cms
  echo; echo "-- ===================== PART 2: conference_cms_test ================"
  part conference_cms_test
  echo; echo "SELECT 'Done - local and test databases are up to date' AS result;"
} > 1-LOCAL-run-this.sql

{
  header "STEP 2 - AIVEN (live): updates conference_cms only"
  echo; echo "-- ===================== conference_cms (Aiven) ====================="
  part conference_cms
  echo; echo "SELECT 'Done - Aiven database is up to date' AS result;"
} > 2-AIVEN-run-this.sql

echo "built 1-LOCAL-run-this.sql and 2-AIVEN-run-this.sql (3-CHECK.sql is hand-written)"
