import { authenticated } from '../auth.js';
import { cart } from '../cart.js';
export function cartRoutes(app) { app.post('/cart', authenticated, cart); }
