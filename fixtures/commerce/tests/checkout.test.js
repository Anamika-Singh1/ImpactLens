import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp, ui } from './helpers.js';
test('known-checkout-total', () => withApp(async request => { assert.equal((await request('/checkout', { price: 1200, quantity: 2 })).body.total, 2400); ui('checkout', 'Checkout'); }));
test('known-checkout-negative-price', () => withApp(async request => { assert.equal((await request('/checkout', { price: -1, quantity: 2 })).status, 400); }));
