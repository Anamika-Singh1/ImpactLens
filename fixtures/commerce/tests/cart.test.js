import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp, ui } from './helpers.js';
test('known-cart-valid-item', () => withApp(async request => { assert.equal((await request('/cart', { productId: 'book', quantity: 2 })).body.quantity, 2); ui('cart', 'Cart'); }));
test('known-cart-invalid-quantity', () => withApp(async request => { assert.equal((await request('/cart', { productId: 'book', quantity: 0 })).status, 400); }));
