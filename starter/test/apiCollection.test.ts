import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { app, databaseHooks, reconcile } from './helpers/database';

databaseHooks();

it('executes the published collection flow and its response assertions', async () => {
  const collection = JSON.parse(readFileSync(join(__dirname, '../bruno/mini-wallet.postman_collection.json'), 'utf8'));
  const variables: Record<string, string> = Object.fromEntries(collection.variable.map((v: { key: string; value: string }) => [v.key, v.value]));
  const substitute = (text: string) => text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    if (variables[key] === undefined) throw new Error('Missing collection variable: ' + key);
    return variables[key];
  });
  for (const item of collection.item) {
    const path = new URL(substitute(item.request.url.raw)).pathname;
    const response = item.request.method === 'GET'
      ? await request(app).get(path)
      : await request(app).post(path).set('Content-Type', 'application/json').send(substitute(item.request.body.raw));
    const pm = {
      test: (_name: string, check: () => void) => check(),
      expect: (value: unknown) => ({ to: { eql: (expected: unknown) => expect(value).toEqual(expected) } }),
      response: { code: response.status, json: () => response.body,
        to: { have: { status: (expected: number) => expect({ request: item.name, status: response.status }).toEqual({ request: item.name, status: expected }) } } },
      collectionVariables: { set: (key: string, value: string) => { variables[key] = value; } },
    };
    for (const event of item.event || []) if (event.listen === 'test') {
      // Only the repository-owned example scripts; never execute request input.
      runInNewContext(event.script.exec.join('\n'), { pm }, { timeout: 1000 });
    }
  }
  await reconcile();
});
