import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp, ui } from './helpers.js';
test('known-catalog-price', () => withApp(async request => { assert.equal((await request('/products')).body[0].price, 1200); ui('catalog', 'Product catalog'); }));
