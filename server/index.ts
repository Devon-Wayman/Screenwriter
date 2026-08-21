import express from 'express';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const dataDir = path.resolve(process.env.SCREENWRITER_DATA_DIR || path.join(appRoot, 'data'));
const distDir = path.join(appRoot, 'dist');
const packageInfo = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8')) as { version?: string };
const appVersion = process.env.APP_VERSION || packageInfo.version || '0.0.0';

app.use(express.json({ limit: '5mb' }));

function safeFilename(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A filename is required.');
  const name = path.basename(value.trim());
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(value)) throw new Error('Invalid filename.');
  return /\.(fountain|txt)$/i.test(name) ? name : `${name}.fountain`;
}

app.get('/api/health', (_request, response) => response.json({ ok: true, version: appVersion }));

app.get('/api/documents', async (_request, response, next) => {
  try {
    await mkdir(dataDir, { recursive: true });
    const entries = await readdir(dataDir, { withFileTypes: true });
    const documents = await Promise.all(entries
      .filter((entry) => entry.isFile() && /\.(fountain|txt)$/i.test(entry.name))
      .map(async (entry) => {
        const info = await stat(path.join(dataDir, entry.name));
        return { name: entry.name, updatedAt: info.mtime.toISOString(), size: info.size };
      }));
    documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    response.json(documents);
  } catch (error) { next(error); }
});

app.get('/api/documents/:name', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name);
    const filePath = path.join(dataDir, name);
    const [content, info] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
    response.json({ name, content, updatedAt: info.mtime.toISOString() });
  } catch (error) { next(error); }
});

app.put('/api/documents/:name', async (request, response, next) => {
  try {
    await mkdir(dataDir, { recursive: true });
    const name = safeFilename(request.params.name);
    if (typeof request.body?.content !== 'string') return response.status(400).json({ error: 'Document content must be text.' });
    const filePath = path.join(dataDir, name);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, request.body.content, 'utf8');
    await rename(temporaryPath, filePath);
    const info = await stat(filePath);
    response.json({ name, updatedAt: info.mtime.toISOString() });
  } catch (error) { next(error); }
});

app.use(express.static(distDir));
app.use((_request, response) => response.sendFile(path.join(distDir, 'index.html')));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  const code = (error as NodeJS.ErrnoException)?.code;
  response.status(code === 'ENOENT' ? 404 : 500).json({ error: code === 'ENOENT' ? 'Document not found.' : message });
});

app.listen(port, '0.0.0.0', () => console.log(`Screenwriter listening on port ${port}; documents: ${dataDir}`));
