import { authenticated } from '../auth.js';
import { checkout } from '../checkout.js';
export function checkoutRoutes(app) { app.post('/checkout', authenticated, checkout); }
