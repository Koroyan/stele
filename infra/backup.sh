#!/usr/bin/env bash
# Nightly backup of a single-host Stele deployment: the PostgreSQL database (custom-format dump,
# restorable with pg_restore) and the content store (the canonical document texts). Keeps
# STELE_BACKUP_DAYS days in STELE_BACKUP_DIR.
#
#   /etc/cron.d/stele-backup:  15 3 * * * root /opt/stele/infra/backup.sh >> /var/log/stele-backup.log 2>&1
#
# These copies live on the same host: copy STELE_BACKUP_DIR off the machine as well (object storage
# with versioning, or another server) — a backup that dies with the server is not a backup.
set -euo pipefail

DIR="${STELE_BACKUP_DIR:-/var/backups/stele}"
DAYS="${STELE_BACKUP_DAYS:-14}"
PROJECT="${STELE_COMPOSE_PROJECT:-stele}"
STAMP="$(date -u +%Y%m%dT%H%MZ)"
mkdir -p "$DIR"
chmod 700 "$DIR"

# The database, consistent at the dump's start (pg_dump uses one snapshot).
docker exec "${PROJECT}-postgres-1" pg_dump -U stele -d stele --format=custom --compress=9 \
  > "$DIR/db-$STAMP.dump.partial"
mv "$DIR/db-$STAMP.dump.partial" "$DIR/db-$STAMP.dump"

# The content store: files are written once under their SHA-256 and never changed.
docker run --rm -v "${PROJECT}_content:/data:ro" -v "$DIR:/backup" alpine:3.20 \
  tar -czf "/backup/content-$STAMP.tar.gz.partial" -C /data .
mv "$DIR/content-$STAMP.tar.gz.partial" "$DIR/content-$STAMP.tar.gz"

# Refuse to keep (and to rotate on the basis of) a dump that is suspiciously small.
size=$(stat -c %s "$DIR/db-$STAMP.dump")
if [ "$size" -lt 10000 ]; then
  echo "$STAMP database dump is only $size bytes: check the database" >&2
  exit 1
fi

find "$DIR" -name 'db-*.dump' -mtime "+$DAYS" -delete
find "$DIR" -name 'content-*.tar.gz' -mtime "+$DAYS" -delete
echo "$STAMP ok: db $(du -h "$DIR/db-$STAMP.dump" | cut -f1), content $(du -h "$DIR/content-$STAMP.tar.gz" | cut -f1)"
