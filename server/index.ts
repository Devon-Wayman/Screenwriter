import express from 'express';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const dataDir = path.resolve(process.env.SCREENWRITER_DATA_DIR || path.join(appRoot, 'data'));
const distDir = path.join(appRoot, 'dist');
const packageInfo = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8')) as { version?: string };
const appVersion = process.env.APP_VERSION || packageInfo.version || '0.0.0';
const appMode = process.env.APP_MODE === 'standalone' ? 'standalone' : 'server';
const documentSettingsPath = path.join(dataDir, 'document-settings.json');
const characterCardsPath = path.join(dataDir, 'character-cards.json');
const spellingDictionariesPath = path.join(dataDir, 'spelling-dictionaries.json');
const stageLayoutsDir = path.join(dataDir, 'stage-layouts');
const legacyProjectsDir = path.join(dataDir, '.projects');
const trashDir = path.join(dataDir, '.trash');

type ProductionType = 'unspecified' | 'stage' | 'feature-film' | 'short-film' | 'television' | 'audio-drama';
type BudgetTier = 'unspecified' | 'micro' | 'low' | 'medium' | 'high';
interface ProductionProfile { targetRuntimeMinutes: number | null; targetAudience: string; budgetTier: BudgetTier; castSizeTarget: number | null; availableLocations: string; stageDimensions: string; availableResources: string }
interface DocumentSettings { productionType: ProductionType; productionProfile: ProductionProfile; autosaveSeconds: number; revisionRetention: number }
const productionTypes = new Set<ProductionType>(['unspecified', 'stage', 'feature-film', 'short-film', 'television', 'audio-drama']);
const budgetTiers = new Set<BudgetTier>(['unspecified', 'micro', 'low', 'medium', 'high']);
const defaultProductionProfile: ProductionProfile = { targetRuntimeMinutes: null, targetAudience: '', budgetTier: 'unspecified', castSizeTarget: null, availableLocations: '', stageDimensions: '', availableResources: '' };
const defaultDocumentSettings: DocumentSettings = { productionType: 'unspecified', productionProfile: defaultProductionProfile, autosaveSeconds: 60, revisionRetention: 20 };

function productionType(value: unknown): ProductionType {
  return typeof value === 'string' && productionTypes.has(value as ProductionType) ? value as ProductionType : 'unspecified';
}

function positiveNumber(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function documentSettings(value: unknown): DocumentSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const profile = input.productionProfile && typeof input.productionProfile === 'object' ? input.productionProfile as Record<string, unknown> : {};
  const autosaveSeconds = Number(input.autosaveSeconds); const revisionRetention = Number(input.revisionRetention);
  return {
    productionType: productionType(input.productionType),
    productionProfile: {
      targetRuntimeMinutes: positiveNumber(profile.targetRuntimeMinutes), targetAudience: typeof profile.targetAudience === 'string' ? profile.targetAudience.slice(0, 200) : '',
      budgetTier: typeof profile.budgetTier === 'string' && budgetTiers.has(profile.budgetTier as BudgetTier) ? profile.budgetTier as BudgetTier : 'unspecified',
      castSizeTarget: positiveNumber(profile.castSizeTarget), availableLocations: typeof profile.availableLocations === 'string' ? profile.availableLocations.slice(0, 2000) : '',
      stageDimensions: typeof profile.stageDimensions === 'string' ? profile.stageDimensions.slice(0, 300) : '', availableResources: typeof profile.availableResources === 'string' ? profile.availableResources.slice(0, 2000) : '',
    },
    autosaveSeconds: [0, 30, 60, 120, 300].includes(autosaveSeconds) ? autosaveSeconds : 60,
    revisionRetention: Math.min(100, Math.max(5, Number.isFinite(revisionRetention) ? Math.round(revisionRetention) : 20)),
  };
}

app.use(express.json({ limit: '5mb' }));

function safeFilename(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A filename is required.');
  const name = path.basename(value.trim());
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(value)) throw new Error('Invalid filename.');
  return /\.(fountain|txt)$/i.test(name) ? name : `${name}.fountain`;
}

app.get('/api/health', (_request, response) => response.json({ ok: true, version: appVersion, mode: appMode }));

async function readDocumentSettings(): Promise<Record<string, DocumentSettings>> {
  try { return JSON.parse(await readFile(documentSettingsPath, 'utf8')); }
  catch { return {}; }
}

async function writeDocumentSettings(settings: Record<string, DocumentSettings>) {
  await mkdir(dataDir, { recursive: true });
  const temporaryPath = `${documentSettingsPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
  await rename(temporaryPath, documentSettingsPath);
}

app.get('/api/document-settings/:name', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name); const settings = await readDocumentSettings();
    response.json(documentSettings(settings[name] || defaultDocumentSettings));
  } catch (error) { next(error); }
});

app.put('/api/document-settings/:name', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name); const settings = await readDocumentSettings();
    settings[name] = documentSettings(request.body);
    await writeDocumentSettings(settings); response.json(settings[name]);
  } catch (error) { next(error); }
});

async function readCharacterCards() { try { return JSON.parse(await readFile(characterCardsPath, 'utf8')) as Record<string, unknown[]>; } catch { return {}; } }
async function writeJsonFile(filePath: string, value: unknown) { await mkdir(dataDir, { recursive: true }); const temporaryPath = `${filePath}.${process.pid}.tmp`; await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8'); await rename(temporaryPath, filePath); }

app.get('/api/character-cards/:name', async (request, response, next) => {
  try { const name = safeFilename(request.params.name); const cards = await readCharacterCards(); response.json(Array.isArray(cards[name]) ? cards[name] : []); }
  catch (error) { next(error); }
});

app.put('/api/character-cards/:name', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name); const input = request.body;
    if (!Array.isArray(input) || input.length > 500) return response.status(400).json({ error: 'Invalid character cards.' });
    const cards = await readCharacterCards(); cards[name] = input.map((card) => {
      const value = card && typeof card === 'object' ? card as Record<string, unknown> : {};
      return { name: String(value.name || '').slice(0, 100), age: String(value.age || '').slice(0, 100), casting: ['female', 'male', 'any'].includes(String(value.casting)) ? value.casting : 'any', traits: String(value.traits || '').slice(0, 1000), description: String(value.description || '').slice(0, 5000) };
    }).filter((card) => card.name);
    await mkdir(dataDir, { recursive: true }); const temporaryPath = `${characterCardsPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(cards, null, 2), 'utf8'); await rename(temporaryPath, characterCardsPath); response.json(cards[name]);
  } catch (error) { next(error); }
});

async function readSpellingDictionaries() { try { return JSON.parse(await readFile(spellingDictionariesPath, 'utf8')) as Record<string, unknown>; } catch { return {}; } }
function spellingWords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((word) => String(word).trim().toLocaleLowerCase()).filter((word) => /^[\p{L}][\p{L}\p{M}'’.-]{0,99}$/u.test(word)))].sort((a, b) => a.localeCompare(b)).slice(0, 5000);
}

app.get('/api/spelling-dictionary/:name', async (request, response, next) => {
  try { const name = safeFilename(request.params.name); const dictionaries = await readSpellingDictionaries(); response.json(spellingWords(dictionaries[name])); }
  catch (error) { next(error); }
});

app.put('/api/spelling-dictionary/:name', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name); const words = spellingWords(request.body);
    if (!Array.isArray(request.body) || request.body.length > 5000) return response.status(400).json({ error: 'Invalid screenplay dictionary.' });
    const dictionaries = await readSpellingDictionaries(); dictionaries[name] = words;
    await mkdir(dataDir, { recursive: true }); const temporaryPath = `${spellingDictionariesPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(dictionaries, null, 2), 'utf8'); await rename(temporaryPath, spellingDictionariesPath); response.json(words);
  } catch (error) { next(error); }
});

interface RevisionSnapshot { id: string; createdAt: string; fingerprint: string; words: number; size: number; content: string }
function revisionDirectory(name: string) { return path.join(dataDir, '.revisions', encodeURIComponent(name)); }
async function revisionSnapshots(name: string): Promise<RevisionSnapshot[]> {
  try {
    const directory = revisionDirectory(name); const entries = await readdir(directory, { withFileTypes: true });
    const snapshots = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map(async (entry) => JSON.parse(await readFile(path.join(directory, entry.name), 'utf8')) as RevisionSnapshot));
    return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch { return []; }
}

app.get('/api/documents/:name/revisions', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name); const snapshots = await revisionSnapshots(name);
    response.json(snapshots.map(({ content: _content, ...metadata }) => metadata));
  } catch (error) { next(error); }
});

app.get('/api/documents/:name/revisions/:id', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name); const id = request.params.id;
    if (!/^[a-f0-9-]{36}$/i.test(id)) return response.status(400).json({ error: 'Invalid revision identifier.' });
    response.json(JSON.parse(await readFile(path.join(revisionDirectory(name), `${id}.json`), 'utf8')) as RevisionSnapshot);
  } catch (error) { next(error); }
});

app.post('/api/documents/:name/autosave', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name); const content = request.body?.content;
    if (typeof content !== 'string') return response.status(400).json({ error: 'Document content must be text.' });
    const filePath = path.join(dataDir, name);
    await mkdir(dataDir, { recursive: true }); const directory = revisionDirectory(name); await mkdir(directory, { recursive: true });
    const fingerprint = createHash('sha256').update(content).digest('hex').slice(0, 12); const existing = await revisionSnapshots(name);
    let snapshot = existing.find((item) => item.fingerprint === fingerprint);
    if (!snapshot) {
      snapshot = { id: randomUUID(), createdAt: new Date().toISOString(), fingerprint, words: content.trim() ? content.trim().split(/\s+/).length : 0, size: Buffer.byteLength(content), content };
      await writeFile(path.join(directory, `${snapshot.id}.json`), JSON.stringify(snapshot), 'utf8');
    }
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, content, 'utf8'); await rename(temporaryPath, filePath);
    const retention = Math.min(100, Math.max(5, Number(request.body?.retention) || 20));
    const after = await revisionSnapshots(name);
    await Promise.all(after.slice(retention).map((item) => unlink(path.join(directory, `${item.id}.json`)).catch(() => undefined)));
    response.json({ revision: { id: snapshot.id, createdAt: snapshot.createdAt, fingerprint: snapshot.fingerprint, words: snapshot.words, size: snapshot.size }, retained: Math.min(after.length, retention) });
  } catch (error) { next(error); }
});

function stageLayoutPath(name: string) { return path.join(stageLayoutsDir, `${encodeURIComponent(name)}.stage-layouts.json`); }
function legacyStageLayoutPath(name: string) { return path.join(legacyProjectsDir, `${encodeURIComponent(name)}.stage-layouts.json`); }

app.get('/api/stage-layouts/:name', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name);
    try { response.json(JSON.parse(await readFile(stageLayoutPath(name), 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { response.json(JSON.parse(await readFile(legacyStageLayoutPath(name), 'utf8'))); }
      catch (legacyError) { if ((legacyError as NodeJS.ErrnoException).code === 'ENOENT') response.json({ version: 1, scenes: [] }); else throw legacyError; }
    }
  } catch (error) { next(error); }
});

app.put('/api/stage-layouts/:name', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name); const layout = request.body;
    if (!layout || layout.version !== 1 || !Array.isArray(layout.scenes)) return response.status(400).json({ error: 'Invalid stage layout document.' });
    const serialized = JSON.stringify(layout, null, 2);
    if (serialized.length > 5_000_000) return response.status(413).json({ error: 'Stage layout data is too large.' });
    await mkdir(stageLayoutsDir, { recursive: true }); const filePath = stageLayoutPath(name); const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, serialized, 'utf8'); await rename(temporaryPath, filePath);
    response.json({ saved: true, updatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

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

async function moveIfPresent(source: string, destination: string) {
  try { await rename(source, destination); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

app.delete('/api/documents/:name', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name); const deletedAt = new Date().toISOString();
    const trashId = `${deletedAt.replace(/[:.]/g, '-')}-${encodeURIComponent(name)}-${randomUUID().slice(0, 8)}`;
    const destination = path.join(trashDir, trashId); await mkdir(destination, { recursive: true });
    const settings = await readDocumentSettings(); const cards = await readCharacterCards(); const dictionaries = await readSpellingDictionaries();
    const metadata = { name, deletedAt, documentSettings: settings[name] || null, characterCards: cards[name] || [], spellingDictionary: spellingWords(dictionaries[name]) };
    await writeFile(path.join(destination, 'project-metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    const movedSource = await moveIfPresent(path.join(dataDir, name), path.join(destination, name));
    await moveIfPresent(stageLayoutPath(name), path.join(destination, 'stage-layouts.json'));
    await moveIfPresent(legacyStageLayoutPath(name), path.join(destination, 'legacy-stage-layouts.json'));
    await moveIfPresent(revisionDirectory(name), path.join(destination, 'revisions'));
    delete settings[name]; delete cards[name]; delete dictionaries[name];
    await Promise.all([writeDocumentSettings(settings), writeJsonFile(characterCardsPath, cards), writeJsonFile(spellingDictionariesPath, dictionaries)]);
    if (!movedSource) return response.status(404).json({ error: 'Screenplay not found.' });
    response.json({ deleted: true, name, deletedAt, trashId });
  } catch (error) { next(error); }
});

app.use(express.static(distDir));
app.use((_request, response) => response.sendFile(path.join(distDir, 'index.html')));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  const code = (error as NodeJS.ErrnoException)?.code;
  response.status(code === 'ENOENT' ? 404 : 500).json({ error: code === 'ENOENT' ? 'Document not found.' : message });
});

app.listen(port, host, () => console.log(`Screenwriter listening on ${host}:${port}; documents: ${dataDir}`));
