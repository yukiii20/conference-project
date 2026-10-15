# Deploying to a production server

This is a plain-English walkthrough for putting the app on a fresh Ubuntu
VPS. It does **not** deploy anything by itself — follow it by hand, step by
step, and check each step worked before moving to the next.

Assumes Ubuntu 22.04 or 24.04, a domain name pointed at the server's IP
address, and a non-root user with `sudo`.

## 1. Basic server setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Install Node.js 20 (via NodeSource) and PM2 (keeps the backend running and
restarts it if it crashes or the server reboots):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. Install and secure MySQL

```bash
sudo apt install -y mysql-server
sudo mysql_secure_installation
```

Answer "yes" to removing anonymous users, disallowing remote root login,
and removing the test database.

Create the database and a dedicated application user — never let the app
connect as root:

```bash
sudo mysql
```

```sql
CREATE DATABASE conference_cms CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'cms_app'@'localhost' IDENTIFIED BY '<a long random password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON conference_cms.* TO 'cms_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 3. Get the code and run the SQL files

```bash
cd /opt
sudo git clone <your repo URL> conference-cms
sudo chown -R $USER:$USER conference-cms
cd conference-cms
```

```bash
mysql -u root -p conference_cms < database/01_schema.sql
mysql -u root -p conference_cms < database/02_reference_data.sql
mysql -u root -p conference_cms < database/03_triggers.sql
mysql -u root -p conference_cms < database/04_admin_extensions.sql
```

(Run them against `conference_cms` specifically; the files already
`USE conference_cms;` internally, but passing it on the command line too
avoids any ambiguity. Run every `database/04_*.sql` file, in filename
order, if there's more than one by the time you read this.)

## 4. Configure and build the backend

```bash
cd server
npm install
cp .env.example .env
nano .env
```

Fill in every value — see the table in the main `README.md`. For
production specifically:

- `NODE_ENV=production`
- `CLIENT_ORIGIN` and `APP_URL` **must** start with `https://` — the
  server refuses to start otherwise.
- `SESSION_SECRET` must be a strong, random, 32+ character value (generate
  one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
  — the server also refuses to start with a short or placeholder value.
- `TRUST_PROXY=1` (Nginx sits in front of the app — this tells Express the
  client's real IP comes from the `X-Forwarded-For` header Nginx sets, which
  rate limiting and audit logs rely on).
- `EMAIL_MODE=smtp` plus the real `SMTP_*`/`MAIL_FROM` values once you're
  ready to send real email (leave `EMAIL_MODE=console` to test everything
  else first without emailing anyone).

Build it:

```bash
npm run build
```

Create the first administrator account:

```bash
npm run create-admin
```

Start it under PM2:

```bash
pm2 start dist/server.js --name cms-backend
pm2 save
pm2 startup   # follow the one printed command to make PM2 survive a reboot
```

Check it's alive: `curl http://localhost:4000/api/health` should print
`{"ok":true}`.

## 5. Build the frontend

From the repo root (not `server/`):

```bash
npm install
npm run build
```

This produces a `dist/` folder of static files — that's the entire
frontend, there's nothing to run continuously for it.

## 6. Nginx: serve the frontend, proxy the API

```bash
sudo apt install -y nginx
```

Create `/etc/nginx/sites-available/conference-cms`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /opt/conference-cms/dist;
    index index.html;

    # The SPA itself
    location / {
        try_files $uri /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Public uploaded images (logos, banners, profile photos)
    location /files/public/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
    }

    # A sensible Content-Security-Policy for the built SPA
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: /files/public/; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" always;
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/conference-cms /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 7. HTTPS with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot edits the Nginx config to listen on 443 and auto-renews via a
systemd timer it installs — nothing further to do. Re-run
`sudo certbot renew --dry-run` any time to confirm renewal still works.

After this, update `server/.env`'s `CLIENT_ORIGIN` and `APP_URL` to the
`https://` address and `pm2 restart cms-backend`.

## 8. Daily backups

Create `/opt/conference-cms/backup.sh`:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR=/var/backups/conference-cms
DATE=$(date +%F)
mkdir -p "$BACKUP_DIR"

# Database
mysqldump -u root -p"$(cat /root/.cms-db-root-password)" conference_cms \
  | gzip > "$BACKUP_DIR/db-$DATE.sql.gz"

# Uploaded files (private submission files + public images)
tar -czf "$BACKUP_DIR/storage-$DATE.tar.gz" -C /opt/conference-cms/server storage

# Keep 14 days, delete anything older
find "$BACKUP_DIR" -name '*.gz' -mtime +14 -delete
```

```bash
chmod +x /opt/conference-cms/backup.sh
echo "<the mysql root password>" | sudo tee /root/.cms-db-root-password
sudo chmod 600 /root/.cms-db-root-password
```

Run it once by hand to check it works, then schedule it daily at 2 AM:

```bash
sudo crontab -e
```

Add:

```
0 2 * * * /opt/conference-cms/backup.sh >> /var/log/cms-backup.log 2>&1
```

### Restoring from a backup

Database:

```bash
gunzip -c /var/backups/conference-cms/db-2026-01-15.sql.gz | mysql -u root -p conference_cms
```

Files:

```bash
cd /opt/conference-cms/server
tar -xzf /var/backups/conference-cms/storage-2026-01-15.tar.gz
```

Then `pm2 restart cms-backend`.

## 9. Updating to a new version later

```bash
cd /opt/conference-cms
git pull
cd server && npm install && npm run build && pm2 restart cms-backend
cd .. && npm install && npm run build
```

(No SQL file needs re-running unless a release specifically says so — this
project never changes the schema without a dedicated migration file.)
