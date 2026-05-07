# Deployment Guide

This guide covers a simple production deployment for the Retrospective app on a Linux server using Node.js, SQLite, `systemd`, and Nginx.

## Readiness Checklist

- Merge the accepted feature branch into `main`.
- Push `main` to the production GitHub repository.
- Make the GitHub repository private before adding live configuration or deployment access.
- Create the production `.env` from `.env.example`.
- Use a non-default `RETRO_ADMIN_KEY`.
- Generate a long `RETRO_AUTH_SECRET` and keep it private.
- Set `RETRO_ALLOWED_ORIGINS` to the final HTTPS domain.
- Store `RETRO_DB_PATH` outside the Git checkout.
- Run migrations on the live database.
- Run the app under `systemd` or another process manager.
- Put Nginx or Apache in front of the Node process with HTTPS and WebSocket proxy support.
- Block direct public access to the Node port at the firewall.
- Configure regular SQLite backups.
- Smoke-test the live domain before sharing it with users.

## Server Setup

Install Node.js, Git, and Nginx on the live server. The exact package commands depend on the Linux distribution, but the target runtime is:

```bash
node --version
npm --version
git --version
nginx -v
```

Create a dedicated service user:

```bash
sudo useradd --system --home /var/www/retrospective --shell /usr/sbin/nologin retrospective
```

Clone the repository into the live directory:

```bash
sudo mkdir -p /var/www/retrospective
sudo chown "$USER":"$USER" /var/www/retrospective
git clone git@github.com:OWNER/REPOSITORY.git /var/www/retrospective
cd /var/www/retrospective
git checkout main
npm ci --omit=dev
```

Create the database directory:

```bash
sudo mkdir -p /var/lib/retrospective
sudo chown retrospective:retrospective /var/lib/retrospective
```

Create the environment file:

```bash
cp .env.example .env
sudo chown root:retrospective .env
sudo chmod 640 .env
```

Edit `.env` and set the live values:

```env
NODE_ENV=production
PORT=3001
RETRO_AUTH_SECRET=<long-random-secret>
RETRO_ADMIN_KEY=<5-lowercase-letters-or-digits>
RETRO_ALLOWED_ORIGINS=https://retro.example.com
RETRO_DB_PATH=/var/lib/retrospective/retros.db
```

Run the database migration:

```bash
npm run db:migrate
```

## Process Manager

Use the example service in `deploy/systemd/retrospective.service` as a starting point.

Before installing the service, confirm the Node path:

```bash
which node
```

If it is not `/usr/bin/node`, update `ExecStart` in the service file.

Install it:

```bash
sudo cp deploy/systemd/retrospective.service /etc/systemd/system/retrospective.service
sudo systemctl daemon-reload
sudo systemctl enable retrospective
sudo systemctl start retrospective
sudo systemctl status retrospective
```

Check the local health endpoint:

```bash
curl http://127.0.0.1:3001/health
```

Expected response:

```json
{"status":"ok","uptimeSeconds":1}
```

## Reverse Proxy

Use the example in `deploy/nginx/retrospective.conf` as a starting point.

Install it:

```bash
sudo cp deploy/nginx/retrospective.conf /etc/nginx/sites-available/retrospective
sudo ln -s /etc/nginx/sites-available/retrospective /etc/nginx/sites-enabled/retrospective
sudo nginx -t
sudo systemctl reload nginx
```

The Nginx config must forward WebSocket upgrade headers. Without that, the live board will load but realtime updates and the timer will fail.

## HTTPS

Use a valid TLS certificate before setting `RETRO_ALLOWED_ORIGINS` to the final domain. With Certbot, the command usually looks like:

```bash
sudo certbot --nginx -d retro.example.com
```

After HTTPS is active, confirm:

```bash
curl https://retro.example.com/health
```

## Backups

Back up the SQLite database file configured by `RETRO_DB_PATH`. A simple safe backup command is:

```bash
sqlite3 /var/lib/retrospective/retros.db ".backup '/var/backups/retrospective/retros-$(date +%F-%H%M%S).db'"
```

Schedule this through cron or a managed backup system. Keep at least one off-server backup.

## Smoke Test

After deployment, test these workflows on the live domain:

- Login as facilitator and create a team.
- Copy the generated team key.
- Create a retrospective.
- Join as a participant using the team key.
- Add Start, Stop, and Continue notes.
- Vote on a card.
- Set and start the timer.
- Create an action from a card.
- Open Actions Report and save action owner, due date, and notes.
- Login as admin and confirm the Teams view loads.

## Release Updates

For later releases:

```bash
cd /var/www/retrospective
git fetch origin
git checkout main
git pull --ff-only
npm ci --omit=dev
npm run db:migrate
sudo systemctl restart retrospective
curl http://127.0.0.1:3001/health
```
