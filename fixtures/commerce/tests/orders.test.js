import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp, ui } from './helpers.js';
test('known-orders-user-scope', () => withApp(async request => { assert.equal((await request('/orders')).body[0].userId, 'user-1'); ui('orders', 'Order history'); }));
