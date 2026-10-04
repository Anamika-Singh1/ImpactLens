import { catalog } from '../catalog.js';
export function catalogRoutes(app) { app.get('/products', catalog); }
