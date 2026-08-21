import express from 'express';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const dataDir = path.resolve(process.env.SCREENWRITER_DATA_DIR || path.join(appRoot, 'data'));
const distDir = path.join(appRoot, 'dist');
const packageInfo = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8')) as { version?: string };
const appVersion = process.env.APP_VERSION || packageInfo.version || '0.0.0';
const ollamaSettingsPath = path.join(dataDir, 'ollama-settings.json');
const analysisReportsPath = path.join(dataDir, 'analysis-reports.json');
const documentSettingsPath = path.join(dataDir, 'document-settings.json');

interface OllamaSettings { endpoint: string; model: string }
interface OllamaModel { name: string; size?: number; modified_at?: string }
type ProductionType = 'unspecified' | 'stage' | 'feature-film' | 'short-film' | 'television' | 'audio-drama';
type BudgetTier = 'unspecified' | 'micro' | 'low' | 'medium' | 'high';
interface ProductionProfile { targetRuntimeMinutes: number | null; targetAudience: string; budgetTier: BudgetTier; castSizeTarget: number | null; availableLocations: string; stageDimensions: string; availableResources: string }
interface DocumentSettings { productionType: ProductionType; productionProfile: ProductionProfile; autosaveSeconds: number; revisionRetention: number }
interface AnalysisReport { id: string; documentName: string; createdAt: string; model: string; endpoint: string; question: string; productionType?: ProductionType; analysis: string; revision: { fingerprint: string; words: number; scenes: number; characters: number } }
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

app.get('/api/health', (_request, response) => response.json({ ok: true, version: appVersion }));

function normalizeOllamaEndpoint(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const url = new URL(value.trim().includes('://') ? value.trim() : `http://${value.trim()}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Ollama endpoint must use HTTP or HTTPS.');
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

async function readOllamaSettings(): Promise<OllamaSettings> {
  try {
    const saved = JSON.parse(await readFile(ollamaSettingsPath, 'utf8')) as Partial<OllamaSettings>;
    return { endpoint: normalizeOllamaEndpoint(saved.endpoint), model: typeof saved.model === 'string' ? saved.model : '' };
  } catch { return { endpoint: '', model: '' }; }
}

async function ollamaModels(endpoint: string): Promise<OllamaModel[]> {
  const result = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2500) });
  if (!result.ok) throw new Error(`Ollama returned HTTP ${result.status}.`);
  const body = await result.json() as { models?: OllamaModel[] };
  return Array.isArray(body.models) ? body.models : [];
}

async function discoverOllama() {
  const settings = await readOllamaSettings();
  const configured = (process.env.OLLAMA_URLS || process.env.OLLAMA_URL || '').split(',').map((item) => item.trim()).filter(Boolean);
  const candidates = [...configured, 'http://ollama:11434', 'http://host.docker.internal:11434', settings.endpoint];
  const unique = [...new Set(candidates.map((item) => { try { return normalizeOllamaEndpoint(item); } catch { return ''; } }).filter(Boolean))];
  for (const endpoint of unique) {
    try { return { connected: true, endpoint, models: await ollamaModels(endpoint), settings }; }
    catch { /* Try the next local or user-configured endpoint. */ }
  }
  return { connected: false, endpoint: settings.endpoint, models: [] as OllamaModel[], settings };
}

async function readAnalysisReports(): Promise<AnalysisReport[]> {
  try {
    const reports = JSON.parse(await readFile(analysisReportsPath, 'utf8'));
    return Array.isArray(reports) ? reports : [];
  } catch { return []; }
}

async function writeAnalysisReports(reports: AnalysisReport[]) {
  await mkdir(dataDir, { recursive: true });
  const temporaryPath = `${analysisReportsPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(reports, null, 2), 'utf8');
  await rename(temporaryPath, analysisReportsPath);
}

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

app.get('/api/ollama/status', async (_request, response, next) => {
  try { response.json(await discoverOllama()); } catch (error) { next(error); }
});

app.put('/api/ollama/settings', async (request, response, next) => {
  try {
    await mkdir(dataDir, { recursive: true });
    const settings: OllamaSettings = {
      endpoint: normalizeOllamaEndpoint(request.body?.endpoint),
      model: typeof request.body?.model === 'string' ? request.body.model.trim() : '',
    };
    const temporaryPath = `${ollamaSettingsPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
    await rename(temporaryPath, ollamaSettingsPath);
    response.json(await discoverOllama());
  } catch (error) { next(error); }
});

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

app.get('/api/ollama/reports/:name', async (request, response, next) => {
  try {
    const name = safeFilename(request.params.name);
    const reports = await readAnalysisReports();
    response.json(reports.filter((report) => report.documentName === name).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  } catch (error) { next(error); }
});

function screenplayChunks(screenplay: string, sceneHeadings: string[], maximumCharacters = 14_000): string[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const heading of sceneHeadings) {
    const position = screenplay.indexOf(heading, cursor);
    if (position >= 0) { starts.push(position); cursor = position + heading.length; }
  }
  const units = starts.length
    ? starts.map((start, index) => screenplay.slice(index === 0 ? 0 : start, starts[index + 1] ?? screenplay.length))
    : screenplay.split(/\n\s*\n/).map((paragraph) => `${paragraph}\n\n`);
  const chunks: string[] = [];
  let active = '';
  for (const unit of units) {
    if (active && active.length + unit.length > maximumCharacters) { chunks.push(active.trim()); active = ''; }
    if (unit.length > maximumCharacters) {
      if (active) { chunks.push(active.trim()); active = ''; }
      for (let offset = 0; offset < unit.length; offset += maximumCharacters) chunks.push(unit.slice(offset, offset + maximumCharacters).trim());
    } else active += unit;
  }
  if (active.trim()) chunks.push(active.trim());
  return chunks.filter(Boolean);
}

async function ollamaChat(endpoint: string, model: string, messages: Array<{ role: string; content: string }>, options: { num_ctx: number; num_predict: number }, json = false) {
  const result = await fetch(`${endpoint}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15 * 60_000),
    body: JSON.stringify({ model, stream: false, ...(json ? { format: 'json' } : {}), options: { temperature: 0.1, ...options }, messages }),
  });
  const body = await result.json() as { message?: { content?: string }; error?: string };
  if (!result.ok) throw new Error(body.error || `Ollama returned HTTP ${result.status}.`);
  return body.message?.content?.trim() || '';
}

app.post('/api/ollama/analyze', async (request, response, next) => {
  try {
    const screenplay = request.body?.screenplay;
    if (typeof screenplay !== 'string' || !screenplay.trim()) return response.status(400).json({ error: 'A screenplay is required.' });
    if (screenplay.length > 1_500_000) return response.status(413).json({ error: 'Screenplay is too large for one analysis request.' });
    const connection = await discoverOllama();
    if (!connection.connected) return response.status(503).json({ error: 'No reachable Ollama endpoint. Open AI settings to configure one.' });
    const requestedModel = typeof request.body?.model === 'string' ? request.body.model.trim() : '';
    const model = requestedModel || connection.settings.model || connection.models[0]?.name;
    if (!model) return response.status(400).json({ error: 'Ollama is connected, but no model is installed or selected.' });
    const question = 'Standard screenplay, production, continuity, and content-rating analysis';
    const documentName = safeFilename(request.body?.documentName || 'Untitled.fountain');
    const revision = request.body?.revision && typeof request.body.revision === 'object' ? request.body.revision : {};
    const grounding = request.body?.grounding && typeof request.body.grounding === 'object' ? request.body.grounding : {};
    const canonicalCharacters: string[] = Array.isArray(grounding.characters) ? grounding.characters.filter((value: unknown): value is string => typeof value === 'string').slice(0, 250) : [];
    const canonicalScenes: string[] = Array.isArray(grounding.scenes) ? grounding.scenes.filter((value: unknown): value is string => typeof value === 'string').slice(0, 500) : [];
    const selectedProductionType = productionType(request.body?.productionType);
    const selectedProductionProfile = documentSettings({ productionType: selectedProductionType, productionProfile: request.body?.productionProfile }).productionProfile;
    const productionConstraints = [
      selectedProductionProfile.targetRuntimeMinutes ? `Target runtime: ${selectedProductionProfile.targetRuntimeMinutes} minutes` : '',
      selectedProductionProfile.targetAudience ? `Target audience: ${selectedProductionProfile.targetAudience}` : '',
      selectedProductionProfile.budgetTier !== 'unspecified' ? `Budget tier: ${selectedProductionProfile.budgetTier}` : '',
      selectedProductionProfile.castSizeTarget ? `Target maximum cast: ${selectedProductionProfile.castSizeTarget}` : '',
      selectedProductionProfile.availableLocations ? `Available locations/settings: ${selectedProductionProfile.availableLocations}` : '',
      selectedProductionProfile.stageDimensions ? `Stage dimensions/playing space: ${selectedProductionProfile.stageDimensions}` : '',
      selectedProductionProfile.availableResources ? `Available resources/equipment/effects: ${selectedProductionProfile.availableResources}` : '',
    ].filter(Boolean).join('\n') || '(no additional constraints supplied)';
    const productionGuidance: Record<ProductionType, string> = {
      unspecified: 'The production medium is unspecified. Avoid firm cost or logistics conclusions that depend on whether locations are physical shoots or representational sets.',
      stage: 'This is a stage production. Treat written locations as potentially representational settings achieved through reusable scenery, props, lighting, projection, sound, or actor movement. Assess set transformations, transition time, backstage space, sightlines, live effects, and performer safety; do not assume every location requires an on-site shoot or company move.',
      'feature-film': 'This is a feature film. Assess physical locations or constructed sets, company moves, permits, travel, coverage, lighting, sound, scheduling, effects, and post-production.',
      'short-film': 'This is a short film. Assess physical locations or constructed sets while emphasizing a compact schedule, limited company moves, and proportionate production scope.',
      television: 'This is a television production. Assess standing sets, episodic location reuse, schedule, coverage, company moves, broadcast or streaming constraints, and repeatable production workflows.',
      'audio-drama': 'This is an audio drama. Treat locations primarily as performance and sound-design requirements. Do not assign physical set, location, wardrobe, or visual-effects costs unless needed for another stated purpose.',
    };
    const reviewPrompt = `Produce one complete report using exactly these clearly labeled sections:
1. Executive assessment — give an overall screenplay score out of 10 and briefly explain what prevents a higher score.
2. Unofficial MPAA-style content rating — choose exactly one likely rating from G, PG, PG-13, R, or NC-17. State clearly that this is an unofficial estimate, not a rating issued by the MPA. Explain the choice by separately assessing language, violence, sexual content or nudity, drugs or alcohol, and thematic intensity. Cite the content that drives the rating and say when a category has no relevant content.
3. Story and structure
4. Character arcs
5. Dialogue
6. Pacing
7. Continuity errors and internal logic — separate confirmed contradictions from possible continuity risks. Check chronology, character knowledge, entrances and exits, locations, props, injuries, wardrobe or physical state when specified, time of day, and cause-and-effect. Cite both conflicting scenes for a confirmed error. If none are supported by the text, explicitly say that no confirmed continuity errors were found rather than inventing one.
8. Themes and audience impact
9. Production feasibility — assess budget, locations, cast, effects, staging, safety, and technical risks separately from writing quality.
10. Five highest-impact revisions — make each recommendation specific and actionable.

For every conclusion, cite a scene heading or specific event from the supplied screenplay. Base claims only on the supplied text, label uncertain inferences, and say when evidence is insufficient. Do not use outside knowledge about real people, existing films, history, or similarly named works. Do not invent biography, authorial intent, staging methods, or historical facts. Avoid automatic praise.

CANONICAL CHARACTER CUES EXTRACTED FROM THIS FILE:
${canonicalCharacters.length ? canonicalCharacters.join(' | ') : '(none detected)'}

CANONICAL SCENE HEADINGS EXTRACTED FROM THIS FILE:
${canonicalScenes.length ? canonicalScenes.map((scene, index) => `${index + 1}. ${scene}`).join('\n') : '(none detected)'}

PRODUCTION FORMAT: ${selectedProductionType}
${productionGuidance[selectedProductionType]}
PRODUCTION CONSTRAINTS:
${productionConstraints}

Never identify someone as a character unless the name appears in the canonical character list or is explicitly named in the screenplay text. A famous real-world associate is not evidence that the person appears in this screenplay.`;
    const chunks = screenplayChunks(screenplay, canonicalScenes);
    const chunkReports: string[] = [];
    let previousLedger = '(first chunk; no prior state)';
    response.status(200).set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const progress = (payload: object) => response.write(`${JSON.stringify(payload)}\n`);
    progress({ type: 'progress', stage: 'chunks', completed: 0, total: chunks.length, message: `Prepared ${chunks.length} screenplay chunks.` });
    for (let index = 0; index < chunks.length; index++) {
      progress({ type: 'progress', stage: 'chunks', completed: index, total: chunks.length, active: index + 1, message: `Analyzing chunk ${index + 1} of ${chunks.length}…` });
      const chunkPrompt = `Analyze screenplay chunk ${index + 1} of ${chunks.length}. Return only compact JSON using these keys:
summary, scenes, charactersPresent, timelineAndLocations, characterStateAtEnd, objectsInjuriesAndPhysicalState, contentRatingEvidence, productionRequirements, confirmedContinuityErrors, possibleContinuityRisks, continuityLedgerForNextChunk.

Each scene entry must include its exact heading and a concise list of events. Use only this chunk and the prior ledger. A confirmed continuity error must quote evidence from both conflicting scenes; otherwise classify it as a possible risk. Do not use outside knowledge. Do not introduce a named character absent from the canonical list and chunk text. Keep the complete JSON under 700 words.

CANONICAL CHARACTERS: ${canonicalCharacters.join(' | ') || '(none detected)'}
PRODUCTION FORMAT: ${selectedProductionType}. ${productionGuidance[selectedProductionType]}
PRODUCTION CONSTRAINTS: ${productionConstraints}
PRIOR CONTINUITY LEDGER: ${previousLedger}

--- CHUNK ${index + 1} SOURCE ---
${chunks[index]}`;
      const chunkReport = await ollamaChat(connection.endpoint, model, [
        { role: 'system', content: 'Extract grounded screenplay evidence into concise JSON. The supplied chunk is the only factual source. Never use knowledge of real people or existing works.' },
        { role: 'user', content: chunkPrompt },
      ], { num_ctx: 8192, num_predict: 1400 }, true);
      chunkReports.push(chunkReport);
      try {
        const parsedChunk = JSON.parse(chunkReport) as { continuityLedgerForNextChunk?: unknown };
        previousLedger = JSON.stringify(parsedChunk.continuityLedgerForNextChunk ?? parsedChunk).slice(0, 6000);
      } catch { previousLedger = chunkReport.slice(0, 6000); }
      progress({ type: 'progress', stage: 'chunks', completed: index + 1, total: chunks.length, message: `Completed chunk ${index + 1} of ${chunks.length}.` });
    }
    const evidencePacket = chunkReports.map((report, index) => `--- CHUNK ${index + 1} EVIDENCE ---\n${report}`).join('\n\n');
    progress({ type: 'progress', stage: 'synthesis', completed: chunks.length, total: chunks.length, message: 'Combining chunk evidence into the final report…' });
    const analysis = await ollamaChat(connection.endpoint, model, [
      { role: 'system', content: 'Synthesize an evidence-bound screenplay report from chunk analyses. The evidence packet is the only factual source. Never add knowledge of real people, history, or existing works.' },
      { role: 'user', content: `${evidencePacket}\n\n--- FINAL REPORT REQUIREMENTS ---\n${reviewPrompt}\n\nReconcile the chunks without repeating their summaries. Keep the final report concise. Treat a continuity issue as confirmed only when the evidence packet contains both sides of the contradiction.` },
    ], { num_ctx: 16384, num_predict: 4096 });
    const report: AnalysisReport = {
      id: randomUUID(), documentName, createdAt: new Date().toISOString(), model, endpoint: connection.endpoint, productionType: selectedProductionType,
      question, analysis,
      revision: {
        fingerprint: createHash('sha256').update(screenplay).digest('hex').slice(0, 12),
        words: Number(revision.words) || screenplay.trim().split(/\s+/).length,
        scenes: Number(revision.scenes) || 0,
        characters: Number(revision.characters) || 0,
      },
    };
    const reports = await readAnalysisReports();
    await writeAnalysisReports([report, ...reports].slice(0, 200));
    progress({ type: 'complete', stage: 'complete', completed: chunks.length, total: chunks.length, message: 'Final report saved.', endpoint: connection.endpoint, model, analysis: report.analysis, report, chunksAnalyzed: chunks.length });
    response.end();
  } catch (error) {
    if (response.headersSent) {
      const message = error instanceof Error ? error.message : 'Analysis failed unexpectedly.';
      response.write(`${JSON.stringify({ type: 'error', message })}\n`); response.end();
    } else next(error);
  }
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
    await mkdir(dataDir, { recursive: true }); const directory = revisionDirectory(name); await mkdir(directory, { recursive: true });
    const fingerprint = createHash('sha256').update(content).digest('hex').slice(0, 12); const existing = await revisionSnapshots(name);
    let snapshot = existing.find((item) => item.fingerprint === fingerprint);
    if (!snapshot) {
      snapshot = { id: randomUUID(), createdAt: new Date().toISOString(), fingerprint, words: content.trim() ? content.trim().split(/\s+/).length : 0, size: Buffer.byteLength(content), content };
      await writeFile(path.join(directory, `${snapshot.id}.json`), JSON.stringify(snapshot), 'utf8');
    }
    const filePath = path.join(dataDir, name); const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, content, 'utf8'); await rename(temporaryPath, filePath);
    const retention = Math.min(100, Math.max(5, Number(request.body?.retention) || 20));
    const after = await revisionSnapshots(name);
    await Promise.all(after.slice(retention).map((item) => unlink(path.join(directory, `${item.id}.json`)).catch(() => undefined)));
    response.json({ revision: { id: snapshot.id, createdAt: snapshot.createdAt, fingerprint: snapshot.fingerprint, words: snapshot.words, size: snapshot.size }, retained: Math.min(after.length, retention) });
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

app.use(express.static(distDir));
app.use((_request, response) => response.sendFile(path.join(distDir, 'index.html')));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  const code = (error as NodeJS.ErrnoException)?.code;
  response.status(code === 'ENOENT' ? 404 : 500).json({ error: code === 'ENOENT' ? 'Document not found.' : message });
});

app.listen(port, '0.0.0.0', () => console.log(`Screenwriter listening on port ${port}; documents: ${dataDir}`));
