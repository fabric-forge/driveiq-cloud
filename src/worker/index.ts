// DriveIQ Cloud — Cloudflare Worker entry point
// Hono router serving driveiq-api.ry-ops.dev. Phase 1: vehicle/maintenance/
// reminders CRUD backed by D1. See MIGRATION_PLAN.md for what's deferred.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env.js';
import { vehicleRoutes } from './routes/vehicle.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { reminderRoutes } from './routes/reminders.js';
import { searchRoutes } from './routes/search.js';
import { pagesRoutes } from './routes/pages.js';
import { importRoutes } from './routes/import.js';
import { vehicleSpecsRoutes } from './routes/vehicleSpecs.js';
import { recallsRoutes } from './routes/recalls.js';

const app = new Hono<{ Bindings: Env }>();

app.use(
	'*',
	cors({
		origin: ['https://driveiq.ry-ops.dev', 'https://driveiq-ui.pages.dev'],
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
		credentials: true,
	})
);

app.get('/health', (c) => c.json({ status: 'ok', service: 'driveiq-api', version: '0.1.0' }));

app.route('/api/vehicle', vehicleRoutes);
app.route('/api/maintenance', maintenanceRoutes);
app.route('/api/reminders', reminderRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/pages', pagesRoutes);
app.route('/api/import', importRoutes);
app.route('/api/vehicle-specs', vehicleSpecsRoutes);
app.route('/api/recalls', recallsRoutes);

export default app;
