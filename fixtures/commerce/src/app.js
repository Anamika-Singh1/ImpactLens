import express from 'express';
import { authenticationRoutes } from './routes/authentication.js';
import { catalogRoutes } from './routes/catalog.js';
import { cartRoutes } from './routes/cart.js';
import { checkoutRoutes } from './routes/checkout.js';
import { orderRoutes } from './routes/orders.js';
export function createApp() {
  const app = express(); app.use(express.json({ limit: '8kb' }));
  authenticationRoutes(app); catalogRoutes(app); cartRoutes(app); checkoutRoutes(app); orderRoutes(app);
  return app;
}
