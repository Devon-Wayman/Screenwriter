import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { estimatedRuntime, parseFountain } from './fountain';
import { createScreenplayPdf, downloadScreenplayPdf, downloadStageLayoutsPdf, layoutScreenplay, type PdfOptions } from './pdf';
import { smartKeyEdit } from './editing';
import { UndoHistory, type HistoryEntry } from './history';
import HelpModal from './HelpModal';
import StageLayout from './StageLayout';
import { cacheDocument, cachedDocument, cachedDocuments, conflictCopyName, pendingSaves, queueSave, removePendingSave, type CachedDocument } from './offline';
import type { BudgetTier, CharacterCard, Diagnostic, DocumentInfo, DocumentSettings, FountainLine, LineType, ProductionProfile, ProductionType, RevisionInfo, StageLayoutDocument } from './types';

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

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) { super(message); }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || `Request failed (${response.status})`, response.status, body);
  return body;
}

export default function App() {
  const [content, setContent] = useState(sample);
  const [filename, setFilename] = useState('Untitled.fountain');
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePanel, setActivePanel] = useState<'characters' | 'corrections' | 'production'>('characters');
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('screenwriter-theme') as Theme) || 'paper');
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('screenwriter-font-size')) || 16);
  const [customSyntaxThemes, setCustomSyntaxThemes] = useState<SavedSyntaxTheme[]>(loadSyntaxThemes);
  const [syntaxTheme, setSyntaxTheme] = useState(() => localStorage.getItem('screenwriter-syntax-theme') || 'Screenwriter Classic');
  const [syntaxEditorOpen, setSyntaxEditorOpen] = useState(false);
  const [draftSyntaxName, setDraftSyntaxName] = useState('My screenplay theme');
  const [draftSyntaxColors, setDraftSyntaxColors] = useState<SyntaxPalette>(builtInSyntaxThemes['Screenwriter Classic']);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfOptions, setPdfOptions] = useState<PdfOptions>({ paperSize: 'letter', includeTitlePage: true, sceneNumbers: false, includeCharacterCards: false, automaticContinuations: true, headerText: '', footerText: '', watermark: '', revisionColor: '#000000', revisionMarks: false });
  const [stageLayouts, setStageLayouts] = useState<StageLayoutDocument>({ version: 1, scenes: [] });
  const [selectedLayoutIds, setSelectedLayoutIds] = useState<string[]>([]);
  const [layoutExportMode, setLayoutExportMode] = useState<'none' | 'append' | 'separate'>('none');
  const [layoutsLoading, setLayoutsLoading] = useState(false);
  const [characterCards, setCharacterCards] = useState<CharacterCard[]>([]);
  const [characterCardOpen, setCharacterCardOpen] = useState(false);
  const [draftCharacterCard, setDraftCharacterCard] = useState<CharacterCard>({ name: '', age: '', casting: 'any', traits: '', description: '' });
  const [focusMode, setFocusMode] = useState(false);
  const [focusPdfEnabled, setFocusPdfEnabled] = useState(() => localStorage.getItem('screenwriter-focus-pdf') === 'true');
  const [focusPreviewContent, setFocusPreviewContent] = useState('');
  const [focusPdfUrl, setFocusPdfUrl] = useState('');
  const [workspaceTab, setWorkspaceTab] = useState<'script' | 'stage'>('script');
  const [helpOpen, setHelpOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [productionType, setProductionType] = useState<ProductionType>('unspecified');
  const [productionProfile, setProductionProfile] = useState<ProductionProfile>(defaultProductionProfile);
  const [autosaveSeconds, setAutosaveSeconds] = useState(60);
  const [revisionRetention, setRevisionRetention] = useState(20);
  const [revisions, setRevisions] = useState<RevisionInfo[]>([]);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const highlightLayer = useRef<HTMLPreElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const history = useRef(new UndoHistory({ text: sample, selectionStart: 0, selectionEnd: 0 }));
  const autosaveState = useRef({ content: sample, filename: 'Untitled.fountain', dirty: false });
  const autosaveRunning = useRef(false);
  const syncRunning = useRef(false);
  const savedContent = useRef(sample);
  const documentRevision = useRef<string | null>(null);
  const activeDocument = useRef({ filename: 'Untitled.fountain', content: sample });
  const parsed = useMemo(() => parseFountain(content), [content]);
  const syntaxColors = useMemo(() => customSyntaxThemes.find((item) => item.name === syntaxTheme)?.colors || builtInSyntaxThemes[syntaxTheme] || builtInSyntaxThemes['Screenwriter Classic'], [customSyntaxThemes, syntaxTheme]);
  const pdfDocument = useMemo(() => pdfOpen ? parseFountain(content) : null, [pdfOpen, content]);
  const pdfLayout = useMemo(() => pdfDocument ? layoutScreenplay(pdfDocument, pdfOptions) : null, [pdfDocument, pdfOptions]);
  const selectedLayouts = useMemo(() => stageLayouts.scenes.filter((scene) => selectedLayoutIds.includes(scene.id)), [stageLayouts, selectedLayoutIds]);
  const focusPreviewDocument = useMemo(() => focusMode && focusPdfEnabled ? parseFountain(focusPreviewContent) : null, [focusMode, focusPdfEnabled, focusPreviewContent]);
  const canUndo = history.current.canUndo;
  const canRedo = history.current.canRedo;
  const matches = useMemo(() => findText ? [...content.toLowerCase().matchAll(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase(), 'g'))] : [], [content, findText]);

  const refreshDocuments = async () => {
    try { setDocuments(await api<DocumentInfo[]>('/api/documents')); setOnline(true); }
    catch (error) {
      const cached = await cachedDocuments().catch(() => []);
      setDocuments(cached.map((item) => ({ name: item.name, updatedAt: item.updatedAt, size: new Blob([item.content]).size })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setOnline(false); setStatus(cached.length ? 'NAS unavailable — showing offline screenplays' : (error instanceof Error ? error.message : 'Could not load files'));
    }
  };
  useEffect(() => { refreshDocuments(); }, []);
  useEffect(() => {
    const updateCount = () => pendingSaves().then((items) => setPendingSaveCount(items.length)).catch(() => undefined);
    const retrySync = () => void synchronizePendingSaves();
    const handleOnline = () => { setOnline(true); retrySync(); };
    const handleOffline = () => { setOnline(false); setStatus('Offline — edits will be kept on this device'); };
    const handleVisibility = () => { if (document.visibilityState === 'visible') retrySync(); };
    const timer = window.setInterval(retrySync, 10_000);
    window.addEventListener('online', handleOnline); window.addEventListener('offline', handleOffline); window.addEventListener('focus', retrySync); document.addEventListener('visibilitychange', handleVisibility);
    void updateCount(); retrySync();
    return () => { window.clearInterval(timer); window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); window.removeEventListener('focus', retrySync); document.removeEventListener('visibilitychange', handleVisibility); };
  }, []);
  useEffect(() => { api<CharacterCard[]>(`/api/character-cards/${encodeURIComponent(filename)}`).then(setCharacterCards).catch(() => setCharacterCards([])); }, [filename]);
  useEffect(() => { autosaveState.current = { content, filename, dirty }; }, [content, filename, dirty]);
  useEffect(() => { activeDocument.current = { content, filename }; }, [content, filename]);
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
  useEffect(() => { localStorage.setItem('screenwriter-focus-pdf', String(focusPdfEnabled)); }, [focusPdfEnabled]);
  useEffect(() => {
    if (!focusMode || !focusPdfEnabled) return;
    const timer = window.setTimeout(() => setFocusPreviewContent(content), 800);
    return () => window.clearTimeout(timer);
  }, [content, focusMode, focusPdfEnabled]);
  useEffect(() => {
    if (!focusPreviewDocument) { setFocusPdfUrl(''); return; }
    const pdf = createScreenplayPdf(focusPreviewDocument, { ...pdfOptions, revisionMarks: false, revisionColor: '#000000' });
    const url = URL.createObjectURL(pdf.output('blob')); setFocusPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [focusPreviewDocument, pdfOptions]);
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
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setWorkspaceTab('script'); setFocusMode((active) => { if (!active && focusPdfEnabled) setFocusPreviewContent(content); return !active; }); return; }
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

  function localDocument(name: string, text: string, revision = documentRevision.current): CachedDocument {
    const now = new Date().toISOString();
    return { name, content: text, revision, updatedAt: now, cachedAt: now };
  }

  async function preserveConflict(name: string, text: string) {
    const conflictName = conflictCopyName(name);
    const saved = await api<{ name: string; updatedAt: string; revision: string }>(`/api/documents/${encodeURIComponent(conflictName)}`, { method: 'PUT', body: JSON.stringify({ content: text }) });
    await cacheDocument({ name: conflictName, content: text, revision: saved.revision, updatedAt: saved.updatedAt, cachedAt: new Date().toISOString() });
    return { name: conflictName, revision: saved.revision };
  }

  async function synchronizePendingSaves() {
    if (syncRunning.current) return;
    syncRunning.current = true;
    try {
      const pending = await pendingSaves().catch(() => []);
      if (!pending.length) { setPendingSaveCount(0); return; }
      setStatus(`Reconnecting to NAS — syncing ${pending.length} screenplay${pending.length === 1 ? '' : 's'}…`);
      let conflicts = 0;
      for (const item of pending) {
        try {
          const saved = await api<{ name: string; updatedAt: string; revision: string }>(`/api/documents/${encodeURIComponent(item.name)}`, { method: 'PUT', body: JSON.stringify({ content: item.content, baseRevision: item.revision }) });
          await cacheDocument({ ...item, revision: saved.revision, updatedAt: saved.updatedAt, cachedAt: new Date().toISOString() });
          await removePendingSave(item.name);
          if (activeDocument.current.filename === item.name && activeDocument.current.content === item.content) documentRevision.current = saved.revision;
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const conflict = await preserveConflict(item.name, item.content);
            await removePendingSave(item.name); conflicts++;
            if (activeDocument.current.filename === item.name && activeDocument.current.content === item.content) { setFilename(conflict.name); documentRevision.current = conflict.revision; }
          } else { setOnline(false); break; }
        }
      }
      const remaining = await pendingSaves().catch(() => []); setPendingSaveCount(remaining.length);
      if (!remaining.length) { setOnline(true); setStatus(conflicts ? `Synced; ${conflicts} newer NAS version preserved alongside an offline conflict copy` : 'Offline changes synced to NAS'); void refreshDocuments(); }
    } finally {
      syncRunning.current = false;
    }
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
      const saved = await api<{ name: string; updatedAt: string; revision: string }>(`/api/documents/${encodeURIComponent(safeName)}`, { method: 'PUT', body: JSON.stringify({ content, baseRevision: documentRevision.current }) });
      documentRevision.current = saved.revision;
      await cacheDocument({ name: safeName, content, revision: saved.revision, updatedAt: saved.updatedAt, cachedAt: new Date().toISOString() });
      await removePendingSave(safeName); setPendingSaveCount((count) => Math.max(0, count - 1));
      await api(`/api/document-settings/${encodeURIComponent(safeName)}`, { method: 'PUT', body: JSON.stringify({ productionType, productionProfile, autosaveSeconds, revisionRetention }) }).catch(() => undefined);
      setFilename(safeName); savedContent.current = content; setDirty(false); setStatus('Saved on NAS'); await refreshDocuments();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try { const conflict = await preserveConflict(safeName, content); setFilename(conflict.name); documentRevision.current = conflict.revision; savedContent.current = content; setDirty(false); setStatus(`The NAS copy changed elsewhere; your work was saved separately as ${conflict.name}`); await refreshDocuments(); }
        catch { setStatus('The NAS copy changed elsewhere and the conflict copy could not be uploaded'); }
      } else {
        await queueSave(localDocument(safeName, content)); setPendingSaveCount((count) => count + (count ? 0 : 1));
        setFilename(safeName); savedContent.current = content; setDirty(false); setOnline(false); setStatus('Saved on this device — waiting for the NAS');
      }
    }
    finally { setSaving(false); }
  }

  async function openDocument(name: string) {
    if (dirty && !confirm('Discard your unsaved changes and open another screenplay?')) return;
    try {
      const document = await api<{ name: string; content: string; updatedAt: string; revision: string }>(`/api/documents/${encodeURIComponent(name)}`);
      documentRevision.current = document.revision; await cacheDocument({ ...document, cachedAt: new Date().toISOString() }); setOnline(true);
      setContent(document.content); setFilename(document.name); resetHistory(document.content); setDirty(false); setStatus(`Opened ${document.name}`);
      void loadDocumentSettings(document.name);
    } catch (error) {
      const document = await cachedDocument(name).catch(() => undefined);
      if (!document) { setStatus(error instanceof Error ? error.message : 'Open failed'); return; }
      documentRevision.current = document.revision; setContent(document.content); setFilename(document.name); resetHistory(document.content); setDirty(false); setOnline(false); setStatus(`Opened offline copy of ${document.name}`);
    }
  }

  function newDocument() {
    if (dirty && !confirm('Discard your unsaved changes?')) return;
    setContent(''); setFilename('Untitled.fountain'); documentRevision.current = null; resetHistory(''); setProductionType('unspecified'); setProductionProfile(defaultProductionProfile); setRevisions([]); setDirty(false); setStatus('New screenplay'); editor.current?.focus();
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
      const saved = await api<{ revision: string }>(`/api/documents/${encodeURIComponent(snapshotFilename)}/autosave`, { method: 'POST', body: JSON.stringify({ content: snapshotContent, retention: revisionRetention, baseRevision: documentRevision.current }) });
      documentRevision.current = saved.revision;
      await cacheDocument({ name: snapshotFilename, content: snapshotContent, revision: saved.revision, updatedAt: new Date().toISOString(), cachedAt: new Date().toISOString() });
      await removePendingSave(snapshotFilename); setPendingSaveCount((await pendingSaves()).length); setOnline(true);
      if (autosaveState.current.content === snapshotContent && autosaveState.current.filename === snapshotFilename) { savedContent.current = snapshotContent; setDirty(false); setStatus('Auto-saved with recovery snapshot'); }
      if (revisionsOpen) void loadRevisions(snapshotFilename); void refreshDocuments();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setStatus('Autosave paused: the NAS copy changed on another device. Use Save to preserve both copies.');
      else { await queueSave(localDocument(snapshotFilename, snapshotContent)); setPendingSaveCount((await pendingSaves()).length); setOnline(false); if (autosaveState.current.content === snapshotContent) { savedContent.current = snapshotContent; setDirty(false); } setStatus('Auto-saved on this device — waiting for the NAS'); }
    }
    finally { autosaveRunning.current = false; }
  }

  async function restoreRevision(id: string) {
    try {
      const snapshot = await api<RevisionInfo & { content: string }>(`/api/documents/${encodeURIComponent(filename)}/revisions/${encodeURIComponent(id)}`);
      setContent(snapshot.content); resetHistory(snapshot.content); setDirty(true); setRevisionsOpen(false); setStatus(`Loaded revision from ${new Date(snapshot.createdAt).toLocaleString()}; save to keep it`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not load revision'); }
  }

  function exportFountain() {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
    setStatus(`Exported ${filename}`);
  }

  async function openPdfExport() {
    setLayoutsLoading(true); setPdfOpen(true);
    try {
      const layouts = await api<StageLayoutDocument>(`/api/stage-layouts/${encodeURIComponent(filename)}`);
      setStageLayouts(layouts); setSelectedLayoutIds(layouts.scenes.map((scene) => scene.id)); setLayoutExportMode(layouts.scenes.some((scene) => scene.shapes.length) ? 'append' : 'none');
    } catch (error) { setStageLayouts({ version: 1, scenes: [] }); setSelectedLayoutIds([]); setLayoutExportMode('none'); setStatus(error instanceof Error ? error.message : 'Could not load scene layouts'); }
    finally { setLayoutsLoading(false); }
  }

  function openCharacterCard(name: string) {
    setDraftCharacterCard(characterCards.find((card) => card.name === name) || { name, age: '', casting: 'any', traits: '', description: '' }); setCharacterCardOpen(true);
  }

  async function saveCharacterCard() {
    const next = [...characterCards.filter((card) => card.name !== draftCharacterCard.name), draftCharacterCard].sort((a, b) => a.name.localeCompare(b.name));
    try { const saved = await api<CharacterCard[]>(`/api/character-cards/${encodeURIComponent(filename)}`, { method: 'PUT', body: JSON.stringify(next) }); setCharacterCards(saved); setCharacterCardOpen(false); setStatus(`Saved character card for ${draftCharacterCard.name}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save character card'); }
  }

  async function deleteCharacterCard() {
    const next = characterCards.filter((card) => card.name !== draftCharacterCard.name);
    try { const saved = await api<CharacterCard[]>(`/api/character-cards/${encodeURIComponent(filename)}`, { method: 'PUT', body: JSON.stringify(next) }); setCharacterCards(saved); setCharacterCardOpen(false); setStatus(`Removed character card for ${draftCharacterCard.name}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not remove character card'); }
  }

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
      const saved = await api<{ updatedAt: string; revision: string }>(`/api/documents/${encodeURIComponent(importedName)}`, { method: 'PUT', body: JSON.stringify({ content: importedContent }) });
      documentRevision.current = saved.revision; await cacheDocument({ name: importedName, content: importedContent, revision: saved.revision, updatedAt: saved.updatedAt, cachedAt: new Date().toISOString() });
      setContent(importedContent); setFilename(importedName); resetHistory(importedContent); setProductionType('unspecified'); setProductionProfile(defaultProductionProfile); setRevisions([]); setDirty(false);
      setStatus(importedName === file.name ? `Imported and backed up ${importedName} on the NAS` : `Imported as ${importedName}; the existing NAS file was preserved`);
      await refreshDocuments();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Import failed'); }
    finally { setSaving(false); if (filePicker.current) filePicker.current.value = ''; }
  }

  return <div className={`app-shell ${focusMode ? 'focus-mode' : ''} ${focusMode && focusPdfEnabled ? 'focus-live-pdf' : ''}`}>
    <header className="topbar">
      <button className="brand" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle files"><span className="brand-mark">S</span><span>Screenwriter</span></button>
      <div className="document-name"><input value={filename} onChange={(event) => { setFilename(event.target.value); documentRevision.current = null; setDirty(true); }} aria-label="Document filename" /><span>{dirty ? 'Unsaved changes' : pendingSaveCount ? `${pendingSaveCount} saved locally · waiting for NAS` : online ? 'All changes saved on NAS' : 'Offline copy ready'}</span></div>
      <nav className="actions">
        <details className="file-menu"><summary>File</summary><div><button onClick={newDocument}>New screenplay</button><button onClick={() => filePicker.current?.click()}>Open / Import Fountain…</button><button onClick={openPdfExport}>Export PDF…</button><button onClick={exportFountain}>Export Fountain…</button><button onClick={() => { void loadRevisions(); setRevisionsOpen(true); }}>Revision history…</button></div></details>
        <input ref={filePicker} className="visually-hidden" type="file" accept=".fountain,.txt,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFountain(file); }} />
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)">Undo</button><button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y or Ctrl/⌘+Shift+Z)">Redo</button><button onClick={() => setFindOpen(!findOpen)}>Find</button>
        <button onClick={() => { setWorkspaceTab('script'); if (focusPdfEnabled) setFocusPreviewContent(content); setFocusMode(true); }} title="Focus Mode (Ctrl/⌘+Shift+F)">Focus</button>
        <button onClick={() => setHelpOpen(true)} title="Help (F1)">Help</button>
        <select value={syntaxTheme} onChange={(event) => setSyntaxTheme(event.target.value)} aria-label="Syntax color theme">{Object.keys(builtInSyntaxThemes).map((value) => <option key={value}>{value}</option>)}{customSyntaxThemes.length > 0 && <optgroup label="My themes">{customSyntaxThemes.map((item) => <option key={item.name}>{item.name}</option>)}</optgroup>}</select>
        <button onClick={openSyntaxEditor}>Colors</button>
        <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)} aria-label="Color theme">{themes.map((value) => <option key={value} value={value}>{themeLabels[value]}</option>)}</select>
        <button className="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </nav>
    </header>
    {!focusMode && <nav className="workspace-tabs" aria-label="Workspace"><button className={workspaceTab === 'script' ? 'active' : ''} onClick={() => setWorkspaceTab('script')}>Script</button><button className={workspaceTab === 'stage' ? 'active' : ''} onClick={() => setWorkspaceTab('stage')}>Stage Layout</button></nav>}
    {findOpen && <div className="findbar"><input autoFocus value={findText} onChange={(event) => setFindText(event.target.value)} placeholder="Find in script"/><span>{matches.length} matches</span><button onClick={() => matches[0] && jumpTo(matches[0].index!, findText.length)}>Next</button><button onClick={() => setFindOpen(false)}>Close</button></div>}
    {workspaceTab === 'script' ? <main className={`workspace ${sidebarOpen ? '' : 'files-closed'}`}>
      {sidebarOpen && <aside className="files-panel">
        <div className="panel-heading"><div><small>LIBRARY</small><h2>Screenplays</h2></div><button onClick={newDocument} title="New screenplay">+</button></div>
        <div className="file-list">{documents.length === 0 && <p className="empty">No saved screenplays yet.</p>}{documents.map((document) => <button className={document.name === filename ? 'active' : ''} key={document.name} onClick={() => void openDocument(document.name)}><span className="file-icon">F</span><span><strong>{document.name.replace(/\.(fountain|txt)$/i, '')}</strong><small>{new Date(document.updatedAt).toLocaleString()}</small></span></button>)}</div>
        <div className={`storage-note ${online ? '' : 'offline'}`}><span>●</span><div><strong>{online ? 'NAS connected' : 'Working offline'}</strong><small>{pendingSaveCount ? `${pendingSaveCount} screenplay${pendingSaveCount === 1 ? '' : 's'} waiting to sync.` : online ? 'Files persist in your mounted data folder.' : 'Saved copies remain on this device.'}</small></div></div>
      </aside>}
      <section className="editor-panel">
        <div className="editor-toolbar"><select onChange={(event) => { const line = parsed.lines.filter((item) => item.type === 'scene')[Number(event.target.value)]; if (line) jumpTo(line.start, line.length); }} defaultValue=""><option value="" disabled>Jump to scene…</option>{parsed.lines.filter((line) => line.type === 'scene').map((line, index) => <option key={line.start} value={index}>{index + 1}. {line.text}</option>)}</select><small className="smart-hint" title="Enter advances elements. Shift+Enter inserts a literal break. Tab starts/cycles elements or adds a parenthetical.">Smart Enter + Tab</small><div><button onClick={() => setFontSize(Math.max(12, fontSize - 1))}>A−</button><span>{fontSize}px</span><button onClick={() => setFontSize(Math.min(28, fontSize + 1))}>A+</button></div></div>
        <div className="editor-stack">
          <HighlightLayer innerRef={highlightLayer} lines={parsed.lines} colors={syntaxColors} fontSize={fontSize} />
          <textarea ref={editor} className="editor" style={{ fontSize }} value={content} wrap="soft" onChange={(event) => { const field = event.currentTarget; const inputType = (event.nativeEvent as InputEvent).inputType || 'typing'; recordContent(field.value, field.selectionStart, field.selectionEnd, inputType); setStatus('Editing…'); }} onKeyDown={handleEditorKey} onScroll={(event) => { if (highlightLayer.current) { highlightLayer.current.scrollTop = event.currentTarget.scrollTop; highlightLayer.current.scrollLeft = event.currentTarget.scrollLeft; } }} spellCheck={false} placeholder="Write Fountain here…" aria-label="Fountain screenplay editor" />
        </div>
        <footer className="statusbar"><span>{status}</span><span>{parsed.sceneCount} scenes · {parsed.characters.length} characters · {parsed.wordCount} words · est. {estimatedRuntime(parsed)}</span></footer>
      </section>
      {focusMode && focusPdfEnabled && <aside className="focus-pdf-preview" aria-label="Read-only screenplay PDF preview"><header><span>PDF PREVIEW · READ ONLY</span><small>{focusPdfUrl ? 'Actual export rendering' : 'Preparing preview…'}</small></header><div>{focusPdfUrl && <iframe src={`${focusPdfUrl}#toolbar=0&navpanes=0`} title="Screenplay PDF preview" />}</div></aside>}
      <aside className="analysis-panel">
        <div className="analysis-summary"><small>DOCUMENT STATS</small><h2>Your screenplay at a glance</h2><div className="metrics"><div><strong>{parsed.sceneCount}</strong><span>Scenes</span></div><div><strong>{parsed.characters.length}</strong><span>Characters</span></div><div><strong>{parsed.wordCount}</strong><span>Words</span></div><div><strong>{estimatedRuntime(parsed)}</strong><span>Runtime</span></div></div></div>
        <div className="tabs"><button className={activePanel === 'characters' ? 'active' : ''} onClick={() => setActivePanel('characters')}>Characters</button><button className={activePanel === 'corrections' ? 'active' : ''} onClick={() => setActivePanel('corrections')}>Corrections <b>{parsed.diagnostics.length}</b></button><button className={activePanel === 'production' ? 'active' : ''} onClick={() => setActivePanel('production')}>Production</button></div>
        <div className="analysis-content">{activePanel === 'characters' ? <>
          {parsed.characters.length === 0 && <p className="empty">Character cues and dialogue will appear here as you write.</p>}
          {parsed.characters.map((character) => <article className="character" key={character.name}><div className="avatar">{character.name.slice(0, 2)}</div><div><h3>{character.name}</h3><p>{character.dialogueLines} lines · {character.dialogueWords} words · {character.sceneCount} scenes</p></div><time>{duration(character.estimatedSeconds)}</time><button className={characterCards.some((card) => card.name === character.name) ? 'card-saved' : ''} onClick={() => openCharacterCard(character.name)} title="Edit character card">Card</button></article>)}
        </> : activePanel === 'corrections' ? <>
          {parsed.diagnostics.length === 0 && <div className="clean"><span>✓</span><h3>Looking good</h3><p>No Fountain corrections found.</p></div>}
          {parsed.diagnostics.map((diagnostic, index) => <article className="correction" key={`${diagnostic.start}-${index}`}><button onClick={() => jumpTo(diagnostic.start, diagnostic.length)}><strong>Line {diagnostic.line + 1}</strong><span>{diagnostic.message}</span></button><button className="fix" onClick={() => applyFix(diagnostic)}>Apply fix</button></article>)}
        </> : <div className="production-panel"><label>Production format<select value={productionType} onChange={(event) => void saveProductionType(event.target.value as ProductionType)}>{(Object.keys(productionLabels) as ProductionType[]).map((value) => <option key={value} value={value}>{productionLabels[value]}</option>)}</select></label><details className="production-constraints" open><summary>Production constraints</summary><div><label>Target runtime (minutes)<input type="number" min="1" value={productionProfile.targetRuntimeMinutes ?? ''} onChange={(event) => setProductionProfile({ ...productionProfile, targetRuntimeMinutes: event.target.value ? Number(event.target.value) : null })} /></label><label>Target audience<input value={productionProfile.targetAudience} onChange={(event) => setProductionProfile({ ...productionProfile, targetAudience: event.target.value })} /></label><label>Budget tier<select value={productionProfile.budgetTier} onChange={(event) => setProductionProfile({ ...productionProfile, budgetTier: event.target.value as BudgetTier })}><option value="unspecified">Not specified</option><option value="micro">Micro</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label>Target maximum cast<input type="number" min="1" value={productionProfile.castSizeTarget ?? ''} onChange={(event) => setProductionProfile({ ...productionProfile, castSizeTarget: event.target.value ? Number(event.target.value) : null })} /></label><label>Available locations or settings<textarea value={productionProfile.availableLocations} onChange={(event) => setProductionProfile({ ...productionProfile, availableLocations: event.target.value })} /></label><label>Stage dimensions / playing space<input value={productionProfile.stageDimensions} onChange={(event) => setProductionProfile({ ...productionProfile, stageDimensions: event.target.value })} placeholder="e.g. 30 ft × 20 ft proscenium" /></label><label>Available equipment, effects, and resources<textarea value={productionProfile.availableResources} onChange={(event) => setProductionProfile({ ...productionProfile, availableResources: event.target.value })} /></label><button onClick={() => void saveProductionProfile()}>Save production settings</button></div></details>
        </div>}</div>
      </aside>
    </main> : <StageLayout documentName={filename} sceneLines={parsed.lines.filter((line) => line.type === 'scene')} onStatus={setStatus} />}
    {focusMode && <div className="focus-controls"><button className={!focusPdfEnabled ? 'active' : ''} onClick={() => { setFocusPdfEnabled(false); requestAnimationFrame(() => editor.current?.focus()); }}>Fountain</button><button className={focusPdfEnabled ? 'active' : ''} onClick={() => { setFocusPdfEnabled(true); setFocusPreviewContent(content); }}>PDF Preview</button><button onClick={() => setFocusMode(false)}><span>Focus Mode</span> Exit <kbd>Esc</kbd></button></div>}
    {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    {characterCardOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCharacterCardOpen(false); }}><section className="character-card-dialog" role="dialog" aria-modal="true" aria-labelledby="character-card-title"><header><div><small>CASTING NOTES</small><h2 id="character-card-title">{draftCharacterCard.name}</h2><p>Saved with this screenplay on the NAS.</p></div><button onClick={() => setCharacterCardOpen(false)} aria-label="Close">×</button></header><div className="character-card-fields"><label>Approximate age or range<input value={draftCharacterCard.age} onChange={(event) => setDraftCharacterCard({ ...draftCharacterCard, age: event.target.value })} placeholder="e.g. late 20s or 35–45" /></label><label>Casting<select value={draftCharacterCard.casting} onChange={(event) => setDraftCharacterCard({ ...draftCharacterCard, casting: event.target.value as CharacterCard['casting'] })}><option value="any">Any gender</option><option value="female">Female</option><option value="male">Male</option></select></label><label>Character traits<textarea value={draftCharacterCard.traits} onChange={(event) => setDraftCharacterCard({ ...draftCharacterCard, traits: event.target.value })} placeholder="Driven, guarded, quick-witted…" /></label><label>Description<textarea value={draftCharacterCard.description} onChange={(event) => setDraftCharacterCard({ ...draftCharacterCard, description: event.target.value })} placeholder="Role in the story, physical or vocal notes, relationships, and arc…" /></label></div><footer>{characterCards.some((card) => card.name === draftCharacterCard.name) && <button className="danger" onClick={() => void deleteCharacterCard()}>Delete card</button>}<span /><button onClick={() => setCharacterCardOpen(false)}>Cancel</button><button className="primary" onClick={() => void saveCharacterCard()}>Save card</button></footer></section></div>}
    {revisionsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRevisionsOpen(false); }}><section className="revisions-dialog" role="dialog" aria-modal="true" aria-labelledby="revisions-title"><header><div><small>RECOVERY</small><h2 id="revisions-title">Revision history</h2><p>Loading a snapshot changes only the editor. The current NAS copy is preserved until you explicitly save.</p></div><button onClick={() => setRevisionsOpen(false)} aria-label="Close">×</button></header><div className="revision-settings"><label>Autosave<select value={autosaveSeconds} onChange={(event) => { const value = Number(event.target.value); setAutosaveSeconds(value); void saveDocumentSettings({ autosaveSeconds: value }); }}><option value="0">Off</option><option value="30">Every 30 seconds</option><option value="60">Every minute</option><option value="120">Every 2 minutes</option><option value="300">Every 5 minutes</option></select></label><label>Keep snapshots<input type="number" min="5" max="100" value={revisionRetention} onChange={(event) => setRevisionRetention(Math.min(100, Math.max(5, Number(event.target.value) || 20)))} onBlur={() => void saveDocumentSettings()} /></label></div><div className="revision-list">{revisions.length === 0 && <p className="empty">No recovery snapshots yet. A snapshot is created when autosave runs after an edit.</p>}{revisions.map((revision) => <article key={revision.id}><div><strong>{new Date(revision.createdAt).toLocaleString()}</strong><span>Revision {revision.fingerprint} · {revision.words} words · {Math.max(1, Math.round(revision.size / 1024))} KB</span></div><button onClick={() => void restoreRevision(revision.id)}>Load in editor</button></article>)}</div><footer><button onClick={() => setRevisionsOpen(false)}>Close</button></footer></section></div>}
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
        <label className="check-option"><input type="checkbox" checked={Boolean(pdfOptions.includeCharacterCards)} disabled={!characterCards.length} onChange={(event) => setPdfOptions({ ...pdfOptions, includeCharacterCards: event.target.checked })} /><span><strong>Character cards</strong><small>{characterCards.length ? `Insert ${characterCards.length} card${characterCards.length === 1 ? '' : 's'} before the script` : 'No character cards have been created'}</small></span></label>
        <div className="pdf-layout-options"><label>Scene layouts<select value={layoutExportMode} disabled={layoutsLoading || !stageLayouts.scenes.length} onChange={(event) => setLayoutExportMode(event.target.value as typeof layoutExportMode)}><option value="none">Do not export</option><option value="append">Append to screenplay PDF</option><option value="separate">Save as a separate PDF</option></select></label><small>{layoutsLoading ? 'Loading saved layouts…' : stageLayouts.scenes.length ? `${selectedLayouts.length} of ${stageLayouts.scenes.length} scenes selected` : 'No saved scene layouts found'}</small></div>
        {layoutExportMode !== 'none' && stageLayouts.scenes.length > 0 && <><div className="pdf-selection-actions"><button onClick={() => setSelectedLayoutIds(stageLayouts.scenes.map((scene) => scene.id))}>Select all</button><button onClick={() => setSelectedLayoutIds([])}>Clear</button></div><div className="pdf-report-select pdf-layout-select">{stageLayouts.scenes.map((scene) => <label key={scene.id}><input type="checkbox" checked={selectedLayoutIds.includes(scene.id)} onChange={(event) => setSelectedLayoutIds(event.target.checked ? [...selectedLayoutIds, scene.id] : selectedLayoutIds.filter((id) => id !== scene.id))} /><span>{scene.sceneNumber ? `${scene.sceneNumber} · ` : ''}{scene.heading} · {scene.shapes.length} items</span></label>)}</div></>}
        <div className="pdf-facts"><span><strong>{pdfLayout.pages.length}</strong> screenplay pages</span><span><strong>{parsed.sceneCount}</strong> scenes</span><span><strong>{parsed.wordCount}</strong> words</span>{layoutExportMode !== 'none' && <span><strong>{selectedLayouts.length}</strong> layout pages {layoutExportMode === 'append' ? 'appended' : 'in separate PDF'}</span>}</div>
        <p className="pdf-note">PDF text uses embedded standard Courier metrics and remains selectable.</p>
      </aside><div className="pdf-preview">{pdfLayout.pages.slice(0, 3).map((page, index) => <div className="pdf-page" key={index} style={{ aspectRatio: `${pdfLayout.width}/${pdfLayout.height}` }}>
        {pdfOptions.watermark && <span className="preview-watermark">{pdfOptions.watermark}</span>}{pdfOptions.headerText && <span className="preview-header">{pdfOptions.headerText}</span>}{pdfOptions.footerText && <span className="preview-footer">{pdfOptions.footerText}</span>}{page.number !== null && page.number > 1 && <span className="preview-page-number">{page.number}</span>}
        {page.blocks.map((block, blockIndex) => <div className={`preview-block ${block.type}`} key={blockIndex} style={{ left: `${block.x / pdfLayout.width * 100}%`, top: `${block.y / pdfLayout.height * 100}%`, width: `${block.width / pdfLayout.width * 100}%`, textAlign: block.align, color: pdfOptions.revisionColor }}>
          {block.sceneNumber && <i className="preview-scene-number">{block.sceneNumber}</i>}{block.lines.map((line, lineIndex) => <div key={lineIndex}>{line.map((run, runIndex) => <span key={runIndex} style={{ fontWeight: run.bold ? 700 : 400, fontStyle: run.italic ? 'italic' : 'normal', textDecoration: run.underline ? 'underline' : 'none' }}>{run.text}</span>)}</div>)}
        </div>)}
      </div>)}{pdfLayout.pages.length > 3 && <p className="more-pages">+ {pdfLayout.pages.length - 3} more pages in the export</p>}</div></div>
      <footer>{selectedLayouts.length > 0 && <button onClick={() => { downloadStageLayoutsPdf(selectedLayouts, pdfOptions, filename); setStatus('Exported selected scene layouts'); }}>Layouts only</button>}<span /><button onClick={() => setPdfOpen(false)}>Cancel</button><button className="primary" onClick={() => { downloadScreenplayPdf(pdfDocument, pdfOptions, filename, layoutExportMode === 'append' ? selectedLayouts : [], characterCards); if (layoutExportMode === 'separate' && selectedLayouts.length) downloadStageLayoutsPdf(selectedLayouts, pdfOptions, filename); setStatus(layoutExportMode === 'separate' && selectedLayouts.length ? 'Exported screenplay and scene-layout PDFs' : `Exported ${filename.replace(/\.(fountain|txt)$/i, '')}.pdf`); setPdfOpen(false); }}>{layoutExportMode === 'separate' && selectedLayouts.length ? 'Download PDFs' : 'Download PDF'}</button></footer>
    </section></div>}
  </div>;
}
