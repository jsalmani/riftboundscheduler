# Riftbound Scheduler

Lightweight availability-matching web app for weekly Riftbound trading card game tournaments. Players fill out a weekly availability grid, then instantly find overlapping free times with any other player.

## Prerequisites

- Node.js 18+

## Setup

```bash
npm install
```

## Run

```bash
node server.js
```

Open: http://localhost:3000

The SQLite database file (`scheduler.db`) is created automatically on first run.

## Test

```bash
node test.js
```

(Requires the server to be running on port 3000)
