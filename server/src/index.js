import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config, { listen } from '@colyseus/tools';
import { defineRoom } from 'colyseus';
import express from 'express';
// QA only (never on Legion): QA_SHIFT=<ms> moves this server's clock (a new day, the featured deal)
if (process.env.QA_SHIFT && !process.env.BLOXITY_GAME_ID) { const shift = +process.env.QA_SHIFT, now0 = Date.now; Date.now = () => now0() + shift; console.log('[qa] clock shifted by', shift, 'ms'); }
const { GlassRoom } = await import('./GlassRoom.js');
import { installStatReporter } from './bloxity.js';
import { statsSummary } from './stats.js';
import { USE_DB } from './profiles.js';

// Serves the built client (client/dist) and the game room on the same port,
// so one Node host is enough to run the whole game.
const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');

// Play stats are private: /api/stats needs ?key=<stats key>. Only the key's SHA-256 lives in the
// public repo (the key itself is in server/STATS_KEY.local.txt); locally (not on Legion) they're open.
const STATS_KEY_SHA256 = '30002e4a1f0c4880f781be645727a9d0f8a891ba6cf255338516658cd6cce824';
const ON_LEGION = !!process.env.BLOXITY_GAME_ID;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const keyOk = (key) => !!key && crypto.timingSafeEqual(sha256(key), Buffer.from(STATS_KEY_SHA256, 'hex'));

const app = config({
    rooms: {
        // one server of up to 16 players (the worlds and their races); the fullest fills first
        glass: defineRoom(GlassRoom).sortBy({ clients: -1 }),
    },
    initializeExpress: (expressApp) => {
        expressApp.get('/health', (req, res) => res.json({ ok: true, db: USE_DB }));
        // Play stats (aggregate, no names): /api/stats?key=<stats key>&days=7 (&raw=50: the newest sessions too)
        expressApp.get('/api/stats', async (req, res) => {
            const key = typeof req.query.key === 'string' ? req.query.key : '';
            if (ON_LEGION && !keyOk(key)) return res.status(401).json({ error: 'bad key' });
            const days = Math.min(60, Math.max(1, Number(req.query.days) || 7));
            const raw = Math.min(500, Math.max(0, Number(req.query.raw) || 0));
            try { res.json(await statsSummary(days, raw)); } catch (e) { res.status(503).json({ error: e.message }); }
        });
        if (fs.existsSync(CLIENT_DIST)) expressApp.use(express.static(CLIENT_DIST));
    },
});

const reporter = installStatReporter();
process.once('beforeExit', () => { reporter.flush(); });
// a stray promise rejection is logged, never allowed to take the server (and every player on it) down
process.on('unhandledRejection', (e) => console.warn('[unhandled]', (e && e.message) || e));

// 2877 locally so this game can run beside the other Legion games; Legion sets PORT
listen(app, Number(process.env.PORT) || 2877);
