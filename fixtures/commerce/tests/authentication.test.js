import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp, ui } from './helpers.js';
test('known-auth-rejects-anonymous', () => withApp(async request => { assert.equal((await request('/session', undefined, false)).status, 401); }));
test('known-auth-accepts-fixture-user', () => withApp(async request => { assert.equal((await request('/session')).body.id, 'user-1'); ui('authentication', 'Sign in'); }));
