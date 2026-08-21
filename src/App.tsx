import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { estimatedRuntime, parseFountain } from './fountain';
import { downloadAnalysisReportsPdf, downloadScreenplayPdf, layoutScreenplay, type PdfOptions } from './pdf';
import { smartKeyEdit } from './editing';
import { UndoHistory, type HistoryEntry } from './history';
import HelpModal from './HelpModal';
import type { AnalysisReport, BudgetTier, Diagnostic, DocumentInfo, DocumentSettings, FountainLine, LineType, OllamaStatus, ProductionProfile, ProductionType, RevisionInfo } from './types';

const sample = `Title: The Glass Harbor
Credit: Written by
Author: Devon Example

# Act One
INT. FERRY TERMINAL - NIGHT

Rain needles the windows. A late ferry groans against the dock.

MARA
I thought the last boat left at ten.

JONAH
(checking his watch)
It did. That's what worries me.

CUT TO:

EXT. HARBOR WALK - LATER

Mara spots a suitcase sitting under a dead payphone.

MARA
Jonah, don't touch it.
`;

const themes = ['paper', 'warm', 'contrast', 'midnight', 'one-dark-darker', 'visual-studio-dark', 'visual-studio-light', 'powershell-ise'] as const;
type Theme = typeof themes[number];
const themeLabels: Record<Theme, string> = { paper:'Paper', warm:'Warm', contrast:'Contrast', midnight:'Midnight', 'one-dark-darker':'One Dark Darker', 'visual-studio-dark':'Visual Studio Dark', 'visual-studio-light':'Visual Studio Light', 'powershell-ise':'PowerShell ISE' };
const productionLabels: Record<ProductionType, string> = { unspecified:'Not specified', stage:'Stage play', 'feature-film':'Feature film', 'short-film':'Short film', television:'Television', 'audio-drama':'Audio drama' };
const defaultProductionProfile: ProductionProfile = { targetRuntimeMinutes:null, targetAudience:'', budgetTier:'unspecified', castSizeTarget:null, availableLocations:'', stageDimensions:'', availableResources:'' };
type SyntaxPalette = Record<LineType, string>;
interface SavedSyntaxTheme { name: string; colors: SyntaxPalette }

const HighlightLayer = memo(function HighlightLayer({ innerRef, lines, colors, fontSize }: { innerRef: RefObject<HTMLPreElement | null>; lines: FountainLine[]; colors: SyntaxPalette; fontSize: number }) {
  return <pre ref={innerRef} className="highlight-layer" style={{ fontSize }} aria-hidden="true">{lines.map((line) => <span key={line.index} style={{ color: colors[line.type] }}>{line.text}{line.index < lines.length - 1 ? '\n' : ''}</span>)}{' '}</pre>;
});

const syntaxLabels: Record<LineType, string> = {
  empty: 'Blank lines', title: 'Title page', scene: 'Scene headings', action: 'Action', character: 'Characters',
  parenthetical: 'Parentheticals', dialogue: 'Dialogue', transition: 'Transitions', section: 'Sections', synopsis: 'Synopses',
  note: 'Notes', boneyard: 'Boneyard', lyric: 'Lyrics', centered: 'Centered text', 'page-break': 'Page breaks',
};
const builtInSyntaxThemes: Record<string, SyntaxPalette> = {
  'Screenwriter Classic': { empty:'#17211c', title:'#7b5c2e', scene:'#176b51', action:'#3d4942', character:'#8a3f62', parenthetical:'#806b28', dialogue:'#253a70', transition:'#a13c31', section:'#7a4ea0', synopsis:'#778079', note:'#8a8178', boneyard:'#aaa39b', lyric:'#2e7181', centered:'#555f59', 'page-break':'#a13c31' },
  'Soft Focus': { empty:'#38433d', title:'#927247', scene:'#37785f', action:'#536159', character:'#9a617a', parenthetical:'#8d7b4a', dialogue:'#526b90', transition:'#a5675d', section:'#80699a', synopsis:'#7f8982', note:'#999187', boneyard:'#b3aca4', lyric:'#4f8290', centered:'#68736c', 'page-break':'#a5675d' },
  'High Contrast': { empty:'#000000', title:'#7a3e00', scene:'#00612e', action:'#161616', character:'#9b0058', parenthetical:'#6e5700', dialogue:'#003caa', transition:'#b00000', section:'#6200a4', synopsis:'#4c4c4c', note:'#686868', boneyard:'#888888', lyric:'#00667a', centered:'#292929', 'page-break':'#b00000' },
  'Midnight Ink': { empty:'#dce7df', title:'#e2bd7f', scene:'#6dd5a6', action:'#c4d0c8', character:'#f49ac1', parenthetical:'#d9c879', dialogue:'#9fbdf5', transition:'#ff958b', section:'#caa4ec', synopsis:'#94a29a', note:'#87958d', boneyard:'#6d7871', lyric:'#81ccdc', centered:'#b8c4bc', 'page-break':'#ff958b' },
  'One Dark Darker': { empty:'#abb2bf', title:'#e6a971', scene:'#33d8e4', action:'#abb2bf', character:'#EF596F', parenthetical:'#e9bd6c', dialogue:'#98c379', transition:'#52ADF2', section:'#D55FDE', synopsis:'#7f848e', note:'#7f848e', boneyard:'#5c6370', lyric:'#58c1cf', centered:'#f5c876', 'page-break':'#EF596F' },
  'Visual Studio Dark': { empty:'#D4D4D4', title:'#D7BA7D', scene:'#569CD6', action:'#D4D4D4', character:'#9CDCFE', parenthetical:'#B5CEA8', dialogue:'#CE9178', transition:'#C586C0', section:'#569CD6', synopsis:'#6A9955', note:'#6A9955', boneyard:'#808080', lyric:'#D7BA7D', centered:'#D4D4D4', 'page-break':'#F44747' },
  'Visual Studio Light': { empty:'#000000', title:'#800000', scene:'#0000FF', action:'#000000', character:'#0451A5', parenthetical:'#098658', dialogue:'#A31515', transition:'#800000', section:'#0000FF', synopsis:'#008000', note:'#008000', boneyard:'#808080', lyric:'#811F3F', centered:'#000080', 'page-break':'#CD3131' },
  'PowerShell ISE': { empty:'#000000', title:'#800080', scene:'#00008B', action:'#000000', character:'#FF4500', parenthetical:'#008080', dialogue:'#8B0000', transition:'#0000FF', section:'#7A3E9D', synopsis:'#006400', note:'#006400', boneyard:'#A9A9A9', lyric:'#008080', centered:'#2D2E45', 'page-break':'#660000' },
};

function loadSyntaxThemes(): SavedSyntaxTheme[] {
  try { return JSON.parse(localStorage.getItem('screenwriter-syntax-themes') || '[]'); } catch { return []; }
}

function duration(seconds: number) {
  const rounded = Math.round(seconds);
  return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}m ${String(rounded % 60).padStart(2, '0')}s`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export default function App() {
  const [content, setContent] = useState(sample);
  const [filename, setFilename] = useState('Untitled.fountain');
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePanel, setActivePanel] = useState<'characters' | 'corrections' | 'ai'>('characters');
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('screenwriter-theme') as Theme) || 'paper');
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('screenwriter-font-size')) || 16);
  const [customSyntaxThemes, setCustomSyntaxThemes] = useState<SavedSyntaxTheme[]>(loadSyntaxThemes);
  const [syntaxTheme, setSyntaxTheme] = useState(() => localStorage.getItem('screenwriter-syntax-theme') || 'Screenwriter Classic');
  const [syntaxEditorOpen, setSyntaxEditorOpen] = useState(false);
  const [draftSyntaxName, setDraftSyntaxName] = useState('My screenplay theme');
  const [draftSyntaxColors, setDraftSyntaxColors] = useState<SyntaxPalette>(builtInSyntaxThemes['Screenwriter Classic']);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfOptions, setPdfOptions] = useState<PdfOptions>({ paperSize: 'letter', includeTitlePage: true, sceneNumbers: false, includeAnalysisReports: false, automaticContinuations: true, headerText: '', footerText: '', watermark: '', revisionColor: '#000000', revisionMarks: false });
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [ollamaSettingsOpen, setOllamaSettingsOpen] = useState(false);
  const [ollamaEndpoint, setOllamaEndpoint] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [analysisReports, setAnalysisReports] = useState<AnalysisReport[]>([]);
  const [productionType, setProductionType] = useState<ProductionType>('unspecified');
  const [productionProfile, setProductionProfile] = useState<ProductionProfile>(defaultProductionProfile);
  const [autosaveSeconds, setAutosaveSeconds] = useState(60);
  const [revisionRetention, setRevisionRetention] = useState(20);
  const [revisions, setRevisions] = useState<RevisionInfo[]>([]);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ stage: 'chunks' | 'synthesis' | 'complete' | 'error'; completed: number; total: number; active?: number; message: string } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const highlightLayer = useRef<HTMLPreElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const history = useRef(new UndoHistory({ text: sample, selectionStart: 0, selectionEnd: 0 }));
  const autosaveState = useRef({ content: sample, filename: 'Untitled.fountain', dirty: false });
  const autosaveRunning = useRef(false);
  const savedContent = useRef(sample);
  const parsed = useMemo(() => parseFountain(content), [content]);
  const syntaxColors = useMemo(() => customSyntaxThemes.find((item) => item.name === syntaxTheme)?.colors || builtInSyntaxThemes[syntaxTheme] || builtInSyntaxThemes['Screenwriter Classic'], [customSyntaxThemes, syntaxTheme]);
  const pdfDocument = useMemo(() => pdfOpen ? parseFountain(content) : null, [pdfOpen, content]);
  const pdfLayout = useMemo(() => pdfDocument ? layoutScreenplay(pdfDocument, pdfOptions) : null, [pdfDocument, pdfOptions]);
  const selectedReports = useMemo(() => analysisReports.filter((report) => selectedReportIds.includes(report.id)), [analysisReports, selectedReportIds]);
  const canUndo = history.current.canUndo;
  const canRedo = history.current.canRedo;
  const matches = useMemo(() => findText ? [...content.toLowerCase().matchAll(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase(), 'g'))] : [], [content, findText]);

  const refreshDocuments = async () => {
    try { setDocuments(await api<DocumentInfo[]>('/api/documents')); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not load files'); }
  };
  useEffect(() => { refreshDocuments(); }, []);
  useEffect(() => { void refreshOllama(); }, []);
  useEffect(() => { autosaveState.current = { content, filename, dirty }; }, [content, filename, dirty]);
  useEffect(() => {
    if (!autosaveSeconds) return;
    const timer = window.setInterval(() => { const current = autosaveState.current; if (current.dirty && !autosaveRunning.current) void autosaveDocument(current.content, current.filename); }, autosaveSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autosaveSeconds, revisionRetention]);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('screenwriter-theme', theme); }, [theme]);
  useEffect(() => {
    const linked: Record<Theme, string> = { paper:'Screenwriter Classic', warm:'Soft Focus', contrast:'High Contrast', midnight:'Midnight Ink', 'one-dark-darker':'One Dark Darker', 'visual-studio-dark':'Visual Studio Dark', 'visual-studio-light':'Visual Studio Light', 'powershell-ise':'PowerShell ISE' };
    const shipped = new Set(Object.values(linked));
    if (shipped.has(syntaxTheme)) setSyntaxTheme(linked[theme]);
  }, [theme]);
  useEffect(() => { localStorage.setItem('screenwriter-font-size', String(fontSize)); }, [fontSize]);
  useEffect(() => { localStorage.setItem('screenwriter-syntax-theme', syntaxTheme); }, [syntaxTheme]);
  useLayoutEffect(() => {
    const field = editor.current, mirror = highlightLayer.current;
    if (!field || !mirror) return;
    mirror.scrollTop = field.scrollTop;
    mirror.scrollLeft = field.scrollLeft;
  }, [content, fontSize, focusMode, syntaxTheme]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'F1') { event.preventDefault(); setHelpOpen(true); return; }
      if (event.key === 'Escape' && helpOpen) { setHelpOpen(false); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && event.target === editor.current) { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'y' && event.target === editor.current) { event.preventDefault(); redo(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setFocusMode((active) => !active); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setFindOpen(true); }
      if (event.key === 'Escape' && focusMode) setFocusMode(false);
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  });

  function restoreHistoryEntry(entry: HistoryEntry | null, action: 'Undo' | 'Redo') {
    if (!entry) { setStatus(`Nothing to ${action.toLowerCase()}`); return; }
    setContent(entry.text); setDirty(entry.text !== savedContent.current); setStatus(action);
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(entry.selectionStart, entry.selectionEnd); });
  }

  function undo() { restoreHistoryEntry(history.current.undo(), 'Undo'); }
  function redo() { restoreHistoryEntry(history.current.redo(), 'Redo'); }

  function recordContent(nextText: string, selectionStart: number, selectionEnd: number, group = 'structural') {
    history.current.record({ text: nextText, selectionStart, selectionEnd }, group);
    setContent(nextText); setDirty(nextText !== savedContent.current);
  }

  function resetHistory(nextText: string, selectionStart = 0) {
    history.current.reset({ text: nextText, selectionStart, selectionEnd: selectionStart });
    savedContent.current = nextText;
  }

  function handleEditorKey(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.nativeEvent as KeyboardEvent).isComposing || (event.key !== 'Enter' && event.key !== 'Tab') || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const field = event.currentTarget;
    const edit = smartKeyEdit(content, field.selectionStart, field.selectionEnd, event.key, event.shiftKey);
    recordContent(edit.text, edit.selectionStart, edit.selectionEnd); setStatus(edit.message);
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(edit.selectionStart, edit.selectionEnd); });
  }

  async function save() {
    let safeName = filename.trim() || 'Untitled.fountain';
    if (!/\.(fountain|txt)$/i.test(safeName)) safeName += '.fountain';
    setSaving(true); setStatus('Saving…');
    try {
      await api(`/api/documents/${encodeURIComponent(safeName)}`, { method: 'PUT', body: JSON.stringify({ content }) });
      await api(`/api/document-settings/${encodeURIComponent(safeName)}`, { method: 'PUT', body: JSON.stringify({ productionType, productionProfile, autosaveSeconds, revisionRetention }) });
      setFilename(safeName); savedContent.current = content; setDirty(false); setStatus('Saved on NAS'); await refreshDocuments();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function openDocument(name: string) {
    if (dirty && !confirm('Discard your unsaved changes and open another screenplay?')) return;
    try {
      const document = await api<{ name: string; content: string }>(`/api/documents/${encodeURIComponent(name)}`);
      setContent(document.content); setFilename(document.name); resetHistory(document.content); setDirty(false); setStatus(`Opened ${document.name}`);
      void loadAnalysisReports(document.name); void loadDocumentSettings(document.name);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Open failed'); }
  }

  function newDocument() {
    if (dirty && !confirm('Discard your unsaved changes?')) return;
    setContent(''); setFilename('Untitled.fountain'); resetHistory(''); setAnalysisReports([]); setAiAnalysis(''); setProductionType('unspecified'); setProductionProfile(defaultProductionProfile); setRevisions([]); setDirty(false); setStatus('New screenplay'); editor.current?.focus();
  }

  function jumpTo(position: number, length = 0) {
    const field = editor.current; if (!field) return;
    field.focus(); field.setSelectionRange(position, position + length);
    const line = content.slice(0, position).split('\n').length;
    field.scrollTop = Math.max(0, (line - 5) * parseFloat(getComputedStyle(field).lineHeight));
  }

  function applyFix(diagnostic: Diagnostic) {
    const next = `${content.slice(0, diagnostic.start)}${diagnostic.replacement}${content.slice(diagnostic.start + diagnostic.length)}`;
    const cursor = diagnostic.start + diagnostic.replacement.length;
    recordContent(next, cursor, cursor); setStatus(`Applied correction on line ${diagnostic.line + 1}`);
  }

  function openSyntaxEditor() {
    setDraftSyntaxColors({ ...syntaxColors });
    setDraftSyntaxName(customSyntaxThemes.some((item) => item.name === syntaxTheme) ? syntaxTheme : `${syntaxTheme} Copy`);
    setSyntaxEditorOpen(true);
  }

  function saveSyntaxTheme() {
    const name = draftSyntaxName.trim();
    if (!name) { setStatus('Give the color theme a name first.'); return; }
    const next = [...customSyntaxThemes.filter((item) => item.name !== name), { name, colors: { ...draftSyntaxColors } }];
    setCustomSyntaxThemes(next); localStorage.setItem('screenwriter-syntax-themes', JSON.stringify(next));
    setSyntaxTheme(name); setSyntaxEditorOpen(false); setStatus(`Saved local color theme “${name}”`);
  }

  function deleteSyntaxTheme() {
    if (!customSyntaxThemes.some((item) => item.name === syntaxTheme)) return;
    const next = customSyntaxThemes.filter((item) => item.name !== syntaxTheme);
    setCustomSyntaxThemes(next); localStorage.setItem('screenwriter-syntax-themes', JSON.stringify(next));
    setSyntaxTheme('Screenwriter Classic'); setSyntaxEditorOpen(false); setStatus('Deleted local color theme');
  }

  async function refreshOllama() {
    try {
      const next = await api<OllamaStatus>('/api/ollama/status');
      setOllama(next); setOllamaEndpoint(next.settings.endpoint || next.endpoint || '');
      setOllamaModel(next.settings.model || next.models[0]?.name || '');
    } catch { setOllama(null); }
  }

  async function loadAnalysisReports(name: string) {
    try { setAnalysisReports(await api<AnalysisReport[]>(`/api/ollama/reports/${encodeURIComponent(name)}`)); }
    catch { setAnalysisReports([]); }
  }

  async function loadDocumentSettings(name: string) {
    try { const settings = await api<DocumentSettings>(`/api/document-settings/${encodeURIComponent(name)}`); setProductionType(settings.productionType); setProductionProfile(settings.productionProfile); setAutosaveSeconds(settings.autosaveSeconds); setRevisionRetention(settings.revisionRetention); }
    catch { setProductionType('unspecified'); setProductionProfile(defaultProductionProfile); }
  }

  async function saveDocumentSettings(overrides: Partial<DocumentSettings> = {}) {
    const settings: DocumentSettings = { productionType, productionProfile, autosaveSeconds, revisionRetention, ...overrides };
    await api(`/api/document-settings/${encodeURIComponent(filename)}`, { method: 'PUT', body: JSON.stringify(settings) });
  }

  async function saveProductionType(next: ProductionType) {
    setProductionType(next);
    try {
      await saveDocumentSettings({ productionType: next });
      setStatus(`Production format saved as ${productionLabels[next]}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save production format'); }
  }

  async function saveProductionProfile() {
    try { await saveDocumentSettings(); setStatus('Production constraints saved for this screenplay'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save production constraints'); }
  }

  async function loadRevisions(name = filename) {
    try { setRevisions(await api<RevisionInfo[]>(`/api/documents/${encodeURIComponent(name)}/revisions`)); }
    catch { setRevisions([]); }
  }

  async function autosaveDocument(snapshotContent: string, snapshotFilename: string) {
    autosaveRunning.current = true;
    try {
      await api(`/api/documents/${encodeURIComponent(snapshotFilename)}/autosave`, { method: 'POST', body: JSON.stringify({ content: snapshotContent, retention: revisionRetention }) });
      if (autosaveState.current.content === snapshotContent && autosaveState.current.filename === snapshotFilename) { savedContent.current = snapshotContent; setDirty(false); setStatus('Auto-saved with recovery snapshot'); }
      if (revisionsOpen) void loadRevisions(snapshotFilename); void refreshDocuments();
    } catch (error) { setStatus(error instanceof Error ? `Autosave failed: ${error.message}` : 'Autosave failed'); }
    finally { autosaveRunning.current = false; }
  }

  async function restoreRevision(id: string) {
    try {
      const snapshot = await api<RevisionInfo & { content: string }>(`/api/documents/${encodeURIComponent(filename)}/revisions/${encodeURIComponent(id)}`);
      setContent(snapshot.content); resetHistory(snapshot.content); setDirty(true); setRevisionsOpen(false); setStatus(`Loaded revision from ${new Date(snapshot.createdAt).toLocaleString()}; save to keep it`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not load revision'); }
  }

  async function saveOllamaSettings() {
    try {
      const next = await api<OllamaStatus>('/api/ollama/settings', { method: 'PUT', body: JSON.stringify({ endpoint: ollamaEndpoint, model: ollamaModel }) });
      setOllama(next); setOllamaModel(next.settings.model || next.models[0]?.name || ollamaModel);
      setStatus(next.connected ? `Connected to Ollama at ${next.endpoint}` : 'Saved endpoint, but Ollama could not be reached');
      if (next.connected) setOllamaSettingsOpen(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save Ollama settings'); }
  }

  async function analyzeScreenplay() {
    setAnalyzing(true); setAnalysisProgress({ stage: 'chunks', completed: 0, total: 0, message: 'Preparing screenplay chunks…' }); setStatus(`Ollama is preparing the screenplay for ${ollamaModel}…`);
    try {
      const analysisDocument = parseFountain(content);
      const response = await fetch('/api/ollama/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screenplay: content, documentName: filename, model: ollamaModel, productionType, productionProfile, grounding: { characters: analysisDocument.characters.map((character) => character.name), scenes: analysisDocument.lines.filter((line) => line.type === 'scene').map((line) => line.text) }, revision: { words: analysisDocument.wordCount, scenes: analysisDocument.sceneCount, characters: analysisDocument.characters.length } }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Analysis request failed (${response.status}).`); }
      if (!response.body) throw new Error('The server did not provide an analysis progress stream.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      type CompletedAnalysis = { analysis: string; model: string; endpoint: string; report: AnalysisReport; chunksAnalyzed: number };
      const completedResult: { value: CompletedAnalysis | null } = { value: null };
      const receive = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as { type: string; stage?: 'chunks' | 'synthesis' | 'complete'; completed?: number; total?: number; active?: number; message?: string; analysis?: string; model?: string; endpoint?: string; report?: AnalysisReport; chunksAnalyzed?: number };
        if (event.type === 'error') throw new Error(event.message || 'Analysis failed.');
        if (event.type === 'progress') {
          const progress = { stage: event.stage || 'chunks', completed: event.completed || 0, total: event.total || 0, active: event.active, message: event.message || 'Analyzing…' };
          setAnalysisProgress(progress); setStatus(progress.message);
        }
        if (event.type === 'complete' && event.report && event.analysis && event.model && event.endpoint) {
          completedResult.value = { analysis: event.analysis, model: event.model, endpoint: event.endpoint, report: event.report, chunksAnalyzed: event.chunksAnalyzed || event.total || 0 };
          setAnalysisProgress({ stage: 'complete', completed: event.total || 0, total: event.total || 0, message: event.message || 'Final report saved.' });
        }
      };
      while (true) {
        const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() || ''; lines.forEach(receive);
        if (done) { if (buffer.trim()) receive(buffer); break; }
      }
      const result = completedResult.value;
      if (!result) throw new Error('Analysis ended before the final report was returned.');
      setAiAnalysis(result.analysis); setAnalysisReports((reports) => [result.report, ...reports]); setStatus(`Saved ${result.chunksAnalyzed}-chunk revision report from ${result.model}`);
    } catch (error) { const message = error instanceof Error ? error.message : 'Analysis failed'; setAnalysisProgress((progress) => ({ stage: 'error', completed: progress?.completed || 0, total: progress?.total || 0, message })); setStatus(message); }
    finally { setAnalyzing(false); }
  }

  function exportFountain() {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
    setStatus(`Exported ${filename}`);
  }

  function openPdfExport() { setSelectedReportIds(analysisReports.map((report) => report.id)); setPdfOptions((options) => ({ ...options, includeAnalysisReports: analysisReports.length > 0 })); setPdfOpen(true); }

  function availableImportName(originalName: string) {
    const normalized = /\.(fountain|txt)$/i.test(originalName) ? originalName : `${originalName}.fountain`;
    const used = new Set(documents.map((document) => document.name.toLowerCase()));
    if (!used.has(normalized.toLowerCase())) return normalized;
    const match = normalized.match(/^(.*?)(\.(?:fountain|txt))$/i);
    const base = match?.[1] || normalized;
    const extension = match?.[2] || '.fountain';
    let number = 2;
    while (used.has(`${base} (${number})${extension}`.toLowerCase())) number++;
    return `${base} (${number})${extension}`;
  }

  async function importFountain(file: File) {
    if (dirty && !confirm('Discard your unsaved changes and import this screenplay?')) return;
    if (!/\.(fountain|txt)$/i.test(file.name)) { setStatus('Choose a .fountain or .txt file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setStatus('That screenplay is larger than the 5 MB import limit.'); return; }
    setSaving(true); setStatus(`Importing ${file.name}…`);
    try {
      const importedContent = await file.text();
      const importedName = availableImportName(file.name);
      await api(`/api/documents/${encodeURIComponent(importedName)}`, { method: 'PUT', body: JSON.stringify({ content: importedContent }) });
      setContent(importedContent); setFilename(importedName); resetHistory(importedContent); setAnalysisReports([]); setAiAnalysis(''); setProductionType('unspecified'); setProductionProfile(defaultProductionProfile); setRevisions([]); setDirty(false);
      setStatus(importedName === file.name ? `Imported and backed up ${importedName} on the NAS` : `Imported as ${importedName}; the existing NAS file was preserved`);
      await refreshDocuments();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Import failed'); }
    finally { setSaving(false); if (filePicker.current) filePicker.current.value = ''; }
  }

  return <div className={`app-shell ${focusMode ? 'focus-mode' : ''}`}>
    <header className="topbar">
      <button className="brand" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle files"><span className="brand-mark">S</span><span>Screenwriter</span></button>
      <div className="document-name"><input value={filename} onChange={(event) => { setFilename(event.target.value); setDirty(true); }} aria-label="Document filename" /><span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span></div>
      <nav className="actions">
        <details className="file-menu"><summary>File</summary><div><button onClick={newDocument}>New screenplay</button><button onClick={() => filePicker.current?.click()}>Open / Import Fountain…</button><button onClick={openPdfExport}>Export PDF…</button><button onClick={exportFountain}>Export Fountain…</button><button onClick={() => { void loadRevisions(); setRevisionsOpen(true); }}>Revision history…</button><button onClick={() => { void refreshOllama(); setOllamaSettingsOpen(true); }}>Ollama settings…</button></div></details>
        <input ref={filePicker} className="visually-hidden" type="file" accept=".fountain,.txt,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFountain(file); }} />
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)">Undo</button><button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y or Ctrl/⌘+Shift+Z)">Redo</button><button onClick={() => setFindOpen(!findOpen)}>Find</button>
        <button onClick={() => setFocusMode(true)} title="Focus Mode (Ctrl/⌘+Shift+F)">Focus</button>
        <button onClick={() => setHelpOpen(true)} title="Help (F1)">Help</button>
        <select value={syntaxTheme} onChange={(event) => setSyntaxTheme(event.target.value)} aria-label="Syntax color theme">{Object.keys(builtInSyntaxThemes).map((value) => <option key={value}>{value}</option>)}{customSyntaxThemes.length > 0 && <optgroup label="My themes">{customSyntaxThemes.map((item) => <option key={item.name}>{item.name}</option>)}</optgroup>}</select>
        <button onClick={openSyntaxEditor}>Colors</button>
        <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)} aria-label="Color theme">{themes.map((value) => <option key={value} value={value}>{themeLabels[value]}</option>)}</select>
        <button className="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </nav>
    </header>
    {findOpen && <div className="findbar"><input autoFocus value={findText} onChange={(event) => setFindText(event.target.value)} placeholder="Find in script"/><span>{matches.length} matches</span><button onClick={() => matches[0] && jumpTo(matches[0].index!, findText.length)}>Next</button><button onClick={() => setFindOpen(false)}>Close</button></div>}
    <main className={`workspace ${sidebarOpen ? '' : 'files-closed'}`}>
      {sidebarOpen && <aside className="files-panel">
        <div className="panel-heading"><div><small>LIBRARY</small><h2>Screenplays</h2></div><button onClick={newDocument} title="New screenplay">+</button></div>
        <div className="file-list">{documents.length === 0 && <p className="empty">No saved screenplays yet.</p>}{documents.map((document) => <button className={document.name === filename ? 'active' : ''} key={document.name} onClick={() => void openDocument(document.name)}><span className="file-icon">F</span><span><strong>{document.name.replace(/\.(fountain|txt)$/i, '')}</strong><small>{new Date(document.updatedAt).toLocaleString()}</small></span></button>)}</div>
        <div className="storage-note"><span>●</span><div><strong>NAS storage</strong><small>Files persist in your mounted data folder.</small></div></div>
      </aside>}
      <section className="editor-panel">
        <div className="editor-toolbar"><select onChange={(event) => { const line = parsed.lines.filter((item) => item.type === 'scene')[Number(event.target.value)]; if (line) jumpTo(line.start, line.length); }} defaultValue=""><option value="" disabled>Jump to scene…</option>{parsed.lines.filter((line) => line.type === 'scene').map((line, index) => <option key={line.start} value={index}>{index + 1}. {line.text}</option>)}</select><small className="smart-hint" title="Enter advances elements. Shift+Enter inserts a literal break. Tab starts/cycles elements or adds a parenthetical.">Smart Enter + Tab</small><div><button onClick={() => setFontSize(Math.max(12, fontSize - 1))}>A−</button><span>{fontSize}px</span><button onClick={() => setFontSize(Math.min(28, fontSize + 1))}>A+</button></div></div>
        <div className="editor-stack">
          <HighlightLayer innerRef={highlightLayer} lines={parsed.lines} colors={syntaxColors} fontSize={fontSize} />
          <textarea ref={editor} className="editor" style={{ fontSize }} value={content} wrap="soft" onChange={(event) => { const field = event.currentTarget; const inputType = (event.nativeEvent as InputEvent).inputType || 'typing'; recordContent(field.value, field.selectionStart, field.selectionEnd, inputType); setStatus('Editing…'); }} onKeyDown={handleEditorKey} onScroll={(event) => { if (highlightLayer.current) { highlightLayer.current.scrollTop = event.currentTarget.scrollTop; highlightLayer.current.scrollLeft = event.currentTarget.scrollLeft; } }} spellCheck={false} placeholder="Write Fountain here…" aria-label="Fountain screenplay editor" />
        </div>
        <footer className="statusbar"><span>{status}</span><span>{parsed.sceneCount} scenes · {parsed.characters.length} characters · {parsed.wordCount} words · est. {estimatedRuntime(parsed)}</span></footer>
      </section>
      <aside className="analysis-panel">
        <div className="analysis-summary"><small>LIVE ANALYSIS</small><h2>Your screenplay at a glance</h2><div className="metrics"><div><strong>{parsed.sceneCount}</strong><span>Scenes</span></div><div><strong>{parsed.characters.length}</strong><span>Characters</span></div><div><strong>{parsed.wordCount}</strong><span>Words</span></div><div><strong>{estimatedRuntime(parsed)}</strong><span>Runtime</span></div></div></div>
        <div className="tabs"><button className={activePanel === 'characters' ? 'active' : ''} onClick={() => setActivePanel('characters')}>Characters</button><button className={activePanel === 'corrections' ? 'active' : ''} onClick={() => setActivePanel('corrections')}>Corrections <b>{parsed.diagnostics.length}</b></button><button className={activePanel === 'ai' ? 'active' : ''} onClick={() => setActivePanel('ai')}>AI</button></div>
        <div className="analysis-content">{activePanel === 'characters' ? <>
          {parsed.characters.length === 0 && <p className="empty">Character cues and dialogue will appear here as you write.</p>}
          {parsed.characters.map((character) => <article className="character" key={character.name}><div className="avatar">{character.name.slice(0, 2)}</div><div><h3>{character.name}</h3><p>{character.dialogueLines} lines · {character.dialogueWords} words · {character.sceneCount} scenes</p></div><time>{duration(character.estimatedSeconds)}</time></article>)}
        </> : activePanel === 'corrections' ? <>
          {parsed.diagnostics.length === 0 && <div className="clean"><span>✓</span><h3>Looking good</h3><p>No Fountain corrections found.</p></div>}
          {parsed.diagnostics.map((diagnostic, index) => <article className="correction" key={`${diagnostic.start}-${index}`}><button onClick={() => jumpTo(diagnostic.start, diagnostic.length)}><strong>Line {diagnostic.line + 1}</strong><span>{diagnostic.message}</span></button><button className="fix" onClick={() => applyFix(diagnostic)}>Apply fix</button></article>)}
        </> : <div className="ai-panel">
          <div className={`ollama-state ${ollama?.connected ? 'connected' : ''}`}><span>●</span><div><strong>{ollama?.connected ? 'Ollama connected' : 'Ollama unavailable'}</strong><small>{ollama?.connected ? ollama.endpoint : 'Configure a NAS or Tailscale endpoint'}</small></div><button onClick={() => { void refreshOllama(); setOllamaSettingsOpen(true); }}>Settings</button></div>
          {ollama?.connected && <><label>Model<select value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)}>{ollama.models.map((model) => <option key={model.name}>{model.name}</option>)}</select></label><label>Production format<select value={productionType} disabled={analyzing} onChange={(event) => void saveProductionType(event.target.value as ProductionType)}>{(Object.keys(productionLabels) as ProductionType[]).map((value) => <option key={value} value={value}>{productionLabels[value]}</option>)}</select></label><details className="production-constraints"><summary>Production constraints</summary><div><label>Target runtime (minutes)<input type="number" min="1" value={productionProfile.targetRuntimeMinutes ?? ''} onChange={(event) => setProductionProfile({ ...productionProfile, targetRuntimeMinutes: event.target.value ? Number(event.target.value) : null })} /></label><label>Target audience<input value={productionProfile.targetAudience} onChange={(event) => setProductionProfile({ ...productionProfile, targetAudience: event.target.value })} /></label><label>Budget tier<select value={productionProfile.budgetTier} onChange={(event) => setProductionProfile({ ...productionProfile, budgetTier: event.target.value as BudgetTier })}><option value="unspecified">Not specified</option><option value="micro">Micro</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label>Target maximum cast<input type="number" min="1" value={productionProfile.castSizeTarget ?? ''} onChange={(event) => setProductionProfile({ ...productionProfile, castSizeTarget: event.target.value ? Number(event.target.value) : null })} /></label><label>Available locations or settings<textarea value={productionProfile.availableLocations} onChange={(event) => setProductionProfile({ ...productionProfile, availableLocations: event.target.value })} /></label><label>Stage dimensions / playing space<input value={productionProfile.stageDimensions} onChange={(event) => setProductionProfile({ ...productionProfile, stageDimensions: event.target.value })} placeholder="e.g. 30 ft × 20 ft proscenium" /></label><label>Available equipment, effects, and resources<textarea value={productionProfile.availableResources} onChange={(event) => setProductionProfile({ ...productionProfile, availableResources: event.target.value })} /></label><button onClick={() => void saveProductionProfile()}>Save constraints</button></div></details><p className="analysis-scope">The standard report covers story, characters, dialogue, pacing, continuity, production feasibility, revisions, and an unofficial MPAA-style content rating.</p><button className="primary ai-run" disabled={analyzing || !content.trim()} onClick={() => void analyzeScreenplay()}>{analyzing ? 'Analyzing…' : 'Analyze screenplay'}</button>{analysisProgress && <div className={`analysis-progress ${analysisProgress.stage}`}><div><strong>{analysisProgress.stage === 'chunks' ? `${analysisProgress.completed} of ${analysisProgress.total || '…'} chunks complete` : analysisProgress.stage === 'synthesis' ? 'Building final report' : analysisProgress.stage === 'complete' ? 'Analysis complete' : 'Analysis stopped'}</strong><span>{analysisProgress.message}</span></div><progress max="100" value={analysisProgress.stage === 'complete' ? 100 : analysisProgress.stage === 'synthesis' ? 92 : analysisProgress.stage === 'error' ? 100 : analysisProgress.total ? Math.round(analysisProgress.completed / analysisProgress.total * 85) : 2} /><small>{analysisProgress.stage === 'chunks' && analysisProgress.total ? `${analysisProgress.total - analysisProgress.completed} chunks remaining` : analysisProgress.stage === 'synthesis' ? 'All chunks passed; Ollama is composing the report.' : analysisProgress.stage === 'complete' ? 'The revision report has been saved.' : analysisProgress.message}</small></div>}</>}
          {analysisReports.length > 0 && <div className="report-history"><h3>Revision reports <b>{analysisReports.length}</b></h3>{analysisReports.map((report, index) => <details className="ai-result" key={report.id} open={index === 0 && report.analysis === aiAnalysis}><summary><strong>{new Date(report.createdAt).toLocaleString()}</strong><span>Revision {report.revision.fingerprint} · {report.model}{report.productionType ? ` · ${productionLabels[report.productionType]}` : ''}</span><small>{report.question}</small></summary><pre>{report.analysis}</pre></details>)}</div>}
        </div>}</div>
      </aside>
    </main>
    {focusMode && <button className="focus-exit" onClick={() => setFocusMode(false)}><span>Focus Mode</span> Exit <kbd>Esc</kbd></button>}
    {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    {revisionsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRevisionsOpen(false); }}><section className="revisions-dialog" role="dialog" aria-modal="true" aria-labelledby="revisions-title"><header><div><small>RECOVERY</small><h2 id="revisions-title">Revision history</h2><p>Loading a snapshot changes only the editor. The current NAS copy is preserved until you explicitly save.</p></div><button onClick={() => setRevisionsOpen(false)} aria-label="Close">×</button></header><div className="revision-settings"><label>Autosave<select value={autosaveSeconds} onChange={(event) => { const value = Number(event.target.value); setAutosaveSeconds(value); void saveDocumentSettings({ autosaveSeconds: value }); }}><option value="0">Off</option><option value="30">Every 30 seconds</option><option value="60">Every minute</option><option value="120">Every 2 minutes</option><option value="300">Every 5 minutes</option></select></label><label>Keep snapshots<input type="number" min="5" max="100" value={revisionRetention} onChange={(event) => setRevisionRetention(Math.min(100, Math.max(5, Number(event.target.value) || 20)))} onBlur={() => void saveDocumentSettings()} /></label></div><div className="revision-list">{revisions.length === 0 && <p className="empty">No recovery snapshots yet. A snapshot is created when autosave runs after an edit.</p>}{revisions.map((revision) => <article key={revision.id}><div><strong>{new Date(revision.createdAt).toLocaleString()}</strong><span>Revision {revision.fingerprint} · {revision.words} words · {Math.max(1, Math.round(revision.size / 1024))} KB</span></div><button onClick={() => void restoreRevision(revision.id)}>Load in editor</button></article>)}</div><footer><button onClick={() => setRevisionsOpen(false)}>Close</button></footer></section></div>}
    {ollamaSettingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOllamaSettingsOpen(false); }}><section className="ollama-dialog" role="dialog" aria-modal="true" aria-labelledby="ollama-title"><header><div><small>LOCAL AI</small><h2 id="ollama-title">Ollama connection</h2><p>Screenwriter checks the NAS automatically, then this fallback endpoint.</p></div><button onClick={() => setOllamaSettingsOpen(false)} aria-label="Close">×</button></header><label>Custom endpoint<input value={ollamaEndpoint} onChange={(event) => setOllamaEndpoint(event.target.value)} placeholder="http://100.x.y.z:11434" /></label><label>Preferred model<input value={ollamaModel} onChange={(event) => setOllamaModel(event.target.value)} placeholder="qwen3.5:4b" /></label><p className="endpoint-note">For a laptop endpoint, Ollama must listen beyond localhost and its firewall must allow port 11434 over Tailscale.</p><footer><button onClick={() => setOllamaSettingsOpen(false)}>Cancel</button><button className="primary" onClick={() => void saveOllamaSettings()}>Save and test</button></footer></section></div>}
    {syntaxEditorOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSyntaxEditorOpen(false); }}><section className="theme-editor" role="dialog" aria-modal="true" aria-labelledby="theme-editor-title">
      <div className="theme-editor-heading"><div><small>SYNTAX COLORS</small><h2 id="theme-editor-title">Create a color theme</h2><p>Customize how Fountain elements appear. Themes are saved in this browser.</p></div><button onClick={() => setSyntaxEditorOpen(false)} aria-label="Close">×</button></div>
      <label className="theme-name">Theme name<input value={draftSyntaxName} onChange={(event) => setDraftSyntaxName(event.target.value)} /></label>
      <div className="color-grid">{(Object.keys(syntaxLabels) as LineType[]).filter((type) => type !== 'empty').map((type) => <label key={type}><span><i style={{ background: draftSyntaxColors[type] }} />{syntaxLabels[type]}</span><input type="color" value={draftSyntaxColors[type]} onChange={(event) => setDraftSyntaxColors({ ...draftSyntaxColors, [type]: event.target.value })} /></label>)}</div>
      <div className="theme-preview" style={{ background: 'var(--paper)' }}><span style={{ color: draftSyntaxColors.scene }}>INT. WRITING ROOM - NIGHT</span><span style={{ color: draftSyntaxColors.action }}>A cursor blinks on the empty page.</span><span style={{ color: draftSyntaxColors.character }}>WRITER</span><span style={{ color: draftSyntaxColors.dialogue }}>This is much easier to read.</span></div>
      <footer>{customSyntaxThemes.some((item) => item.name === syntaxTheme) && <button className="danger" onClick={deleteSyntaxTheme}>Delete current theme</button>}<span /><button onClick={() => setSyntaxEditorOpen(false)}>Cancel</button><button className="primary" onClick={saveSyntaxTheme}>Save as local theme</button></footer>
    </section></div>}
    {pdfOpen && pdfLayout && pdfDocument && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPdfOpen(false); }}><section className="pdf-dialog" role="dialog" aria-modal="true" aria-labelledby="pdf-dialog-title">
      <header><div><small>SCREENPLAY OUTPUT</small><h2 id="pdf-dialog-title">Export PDF</h2><p>Preview the formatted screenplay before downloading it.</p></div><button onClick={() => setPdfOpen(false)} aria-label="Close">×</button></header>
      <div className="pdf-dialog-body"><aside>
        <label>Paper size<select value={pdfOptions.paperSize} onChange={(event) => setPdfOptions({ ...pdfOptions, paperSize: event.target.value as PdfOptions['paperSize'] })}><option value="letter">US Letter</option><option value="a4">A4</option></select></label>
        <label className="check-option"><input type="checkbox" checked={pdfOptions.includeTitlePage} disabled={!Object.keys(parsed.titlePage).length} onChange={(event) => setPdfOptions({ ...pdfOptions, includeTitlePage: event.target.checked })} /><span><strong>Title page</strong><small>{Object.keys(parsed.titlePage).length ? 'Use Fountain title metadata' : 'No title metadata found'}</small></span></label>
        <label className="check-option"><input type="checkbox" checked={pdfOptions.sceneNumbers} onChange={(event) => setPdfOptions({ ...pdfOptions, sceneNumbers: event.target.checked })} /><span><strong>Scene numbers</strong><small>Print on both page margins</small></span></label>
        <label className="check-option"><input type="checkbox" checked={pdfOptions.automaticContinuations !== false} onChange={(event) => setPdfOptions({ ...pdfOptions, automaticContinuations: event.target.checked })} /><span><strong>Dialogue continuations</strong><small>Add (MORE) and character (CONT'D) across page breaks</small></span></label>
        <label className="check-option"><input type="checkbox" checked={Boolean(pdfOptions.revisionMarks)} onChange={(event) => setPdfOptions({ ...pdfOptions, revisionMarks: event.target.checked })} /><span><strong>Revision marks</strong><small>Mark revised draft blocks in the right margin</small></span></label>
        <div className="pdf-fields"><label>Revision color<input type="color" value={pdfOptions.revisionColor} onChange={(event) => setPdfOptions({ ...pdfOptions, revisionColor: event.target.value })} /></label><label>Header<input value={pdfOptions.headerText} onChange={(event) => setPdfOptions({ ...pdfOptions, headerText: event.target.value })} placeholder="Draft date or production" /></label><label>Footer<input value={pdfOptions.footerText} onChange={(event) => setPdfOptions({ ...pdfOptions, footerText: event.target.value })} placeholder="Confidential" /></label><label>Watermark<input value={pdfOptions.watermark} onChange={(event) => setPdfOptions({ ...pdfOptions, watermark: event.target.value })} placeholder="DRAFT" /></label></div>
        <label className="check-option"><input type="checkbox" checked={Boolean(pdfOptions.includeAnalysisReports)} disabled={!analysisReports.length} onChange={(event) => setPdfOptions({ ...pdfOptions, includeAnalysisReports: event.target.checked })} /><span><strong>Analysis reports</strong><small>{analysisReports.length ? `Append ${selectedReports.length} selected report${selectedReports.length === 1 ? '' : 's'}` : 'No saved reports for this screenplay'}</small></span></label>
        {analysisReports.length > 0 && <div className="pdf-report-select">{analysisReports.map((report) => <label key={report.id}><input type="checkbox" checked={selectedReportIds.includes(report.id)} onChange={(event) => setSelectedReportIds(event.target.checked ? [...selectedReportIds, report.id] : selectedReportIds.filter((id) => id !== report.id))} /><span>{new Date(report.createdAt).toLocaleDateString()} · {report.revision.fingerprint}</span></label>)}</div>}
        <div className="pdf-facts"><span><strong>{pdfLayout.pages.length}</strong> screenplay pages</span><span><strong>{parsed.sceneCount}</strong> scenes</span><span><strong>{parsed.wordCount}</strong> words</span>{pdfOptions.includeAnalysisReports && <span><strong>{selectedReports.length}</strong> appended reports</span>}</div>
        <p className="pdf-note">PDF text uses embedded standard Courier metrics and remains selectable.</p>
      </aside><div className="pdf-preview">{pdfLayout.pages.slice(0, 3).map((page, index) => <div className="pdf-page" key={index} style={{ aspectRatio: `${pdfLayout.width}/${pdfLayout.height}` }}>
        {pdfOptions.watermark && <span className="preview-watermark">{pdfOptions.watermark}</span>}{pdfOptions.headerText && <span className="preview-header">{pdfOptions.headerText}</span>}{pdfOptions.footerText && <span className="preview-footer">{pdfOptions.footerText}</span>}{page.number !== null && page.number > 1 && <span className="preview-page-number">{page.number}</span>}
        {page.blocks.map((block, blockIndex) => <div className={`preview-block ${block.type}`} key={blockIndex} style={{ left: `${block.x / pdfLayout.width * 100}%`, top: `${block.y / pdfLayout.height * 100}%`, width: `${block.width / pdfLayout.width * 100}%`, textAlign: block.align, color: pdfOptions.revisionColor }}>
          {block.sceneNumber && <i className="preview-scene-number">{block.sceneNumber}</i>}{block.lines.map((line, lineIndex) => <div key={lineIndex}>{line.map((run, runIndex) => <span key={runIndex} style={{ fontWeight: run.bold ? 700 : 400, fontStyle: run.italic ? 'italic' : 'normal', textDecoration: run.underline ? 'underline' : 'none' }}>{run.text}</span>)}</div>)}
        </div>)}
      </div>)}{pdfLayout.pages.length > 3 && <p className="more-pages">+ {pdfLayout.pages.length - 3} more pages in the export</p>}</div></div>
      <footer>{selectedReports.length > 0 && <button onClick={() => { downloadAnalysisReportsPdf(selectedReports, pdfOptions, filename); setStatus('Exported selected analysis reports'); }}>Reports only</button>}<span /><button onClick={() => setPdfOpen(false)}>Cancel</button><button className="primary" onClick={() => { downloadScreenplayPdf(pdfDocument, pdfOptions, filename, selectedReports); setStatus(`Exported ${filename.replace(/\.(fountain|txt)$/i, '')}.pdf`); setPdfOpen(false); }}>Download PDF</button></footer>
    </section></div>}
  </div>;
}
