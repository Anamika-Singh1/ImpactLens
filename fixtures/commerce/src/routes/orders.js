import { authenticated } from '../auth.js';
import { orders } from '../orders.js';
export function orderRoutes(app) { app.get('/orders', authenticated, orders); }
