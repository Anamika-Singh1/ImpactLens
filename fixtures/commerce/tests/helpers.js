import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Commerce } from '../src/ui/Commerce.js';
export async function withApp(run) {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(async (path, data, authorized = true) => {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { ...(authorized ? { Authorization: 'Bearer fixture-user' } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
export function ui(page, text) { assert.match(renderToStaticMarkup(React.createElement(Commerce, { page })), new RegExp(text)); }
