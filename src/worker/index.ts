// DriveIQ Cloud — Cloudflare Worker entry point
// Hono router serving driveiq-api.ry-ops.dev. Phase 1: vehicle/maintenance/
// reminders CRUD backed by D1. See MIGRATION_PLAN.md for what's deferred.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env.js';
import { vehicleRoutes } from './routes/vehicle.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { reminderRoutes } from './routes/reminders.js';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));

app.get('/health', (c) => c.json({ status: 'ok', service: 'driveiq-api', version: '0.1.0' }));

app.route('/api/vehicle', vehicleRoutes);
app.route('/api/maintenance', maintenanceRoutes);
app.route('/api/reminders', reminderRoutes);

export default app;
