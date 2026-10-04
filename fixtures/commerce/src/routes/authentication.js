import { authenticated } from '../auth.js';
export function authenticationRoutes(app) { app.get('/session', authenticated, (req, res) => res.json(req.user)); }
