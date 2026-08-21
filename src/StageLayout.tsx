import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { FountainLine, StageLayoutDocument, StageSceneLayout, StageShape, StageShapeType } from './types';

interface Props { documentName: string; sceneLines: FountainLine[]; onStatus: (message: string) => void }

function sceneNumber(line: FountainLine) { return line.sceneNumber || undefined; }
function normalized(value: string) { return value.trim().toUpperCase(); }
let localIdSequence = 0;
function localId() { localIdSequence += 1; return `stage-${Date.now().toString(36)}-${localIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

export function reconcileScenes(existing: StageSceneLayout[], lines: FountainLine[]): StageSceneLayout[] {
  const unused = new Set(existing.map((scene) => scene.id));
  return lines.map((line, order) => {
    const numbered = sceneNumber(line);
    const candidates = existing.filter((scene) => unused.has(scene.id));
    const match = (numbered && candidates.find((scene) => scene.sceneNumber === numbered))
      || candidates.find((scene) => normalized(scene.heading) === normalized(line.text))
      || candidates.find((scene) => scene.order === order);
    if (match) { unused.delete(match.id); return { ...match, heading: line.text, sceneNumber: numbered, order }; }
    return { id: localId(), heading: line.text, sceneNumber: numbered, order, shapes: [], updatedAt: new Date().toISOString() };
  });
}

const shapeDefaults: Record<StageShapeType, Pick<StageShape, 'width' | 'height' | 'label' | 'color'>> = {
  rectangle: { width: 150, height: 80, label: 'Set piece', color: '#6f8f7c' }, circle: { width: 90, height: 90, label: 'Round prop', color: '#879e75' },
  line: { width: 170, height: 4, label: 'Wall / boundary', color: '#4d5b53' }, label: { width: 170, height: 45, label: 'Note', color: '#9b815b' },
  light: { width: 64, height: 64, label: 'Light', color: '#d6a637' }, actor: { width: 58, height: 58, label: 'Actor', color: '#8a5970' },
};

export default function StageLayout({ documentName, sceneLines, onStatus }: Props) {
  const [document, setDocument] = useState<StageLayoutDocument>({ version: 1, scenes: [] });
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [selectedShapeId, setSelectedShapeId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<'loading' | 'pending' | 'saving' | 'saved' | 'error'>('loading');
  const [layoutError, setLayoutError] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; pointerX: number; pointerY: number; shapeX: number; shapeY: number } | null>(null);
  const signature = useMemo(() => sceneLines.map((line) => `${line.sceneNumber || ''}:${line.text}`).join('|'), [sceneLines]);
  const activeScene = document.scenes.find((scene) => scene.id === selectedSceneId) || document.scenes[0];
  const activeShape = activeScene?.shapes.find((shape) => shape.id === selectedShapeId);

  useEffect(() => {
    let cancelled = false; setLoaded(false); setSaveState('loading'); setLayoutError('');
    fetch(`/api/stage-layouts/${encodeURIComponent(documentName)}`).then(async (response) => {
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not load stage layouts.');
      return response.json() as Promise<StageLayoutDocument>;
    }).then((saved) => {
      if (cancelled) return; const scenes = reconcileScenes(saved.scenes || [], sceneLines);
      setDocument({ version: 1, scenes }); setSelectedSceneId((current) => scenes.some((scene) => scene.id === current) ? current : scenes[0]?.id || ''); setSelectedShapeId(''); setLoaded(true); setSaveState('saved');
    }).catch((error) => { if (!cancelled) { const message = error instanceof Error ? error.message : 'Could not load stage layouts'; onStatus(message); setLayoutError(message); setSaveState('error'); } });
    return () => { cancelled = true; };
  }, [documentName, signature]);

  useEffect(() => {
    if (!loaded) return;
    setSaveState('pending');
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      fetch(`/api/stage-layouts/${encodeURIComponent(documentName)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document) })
        .then(async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Stage layout save failed (${response.status}).`); setLayoutError(''); setSaveState('saved'); onStatus('Stage layout saved on NAS'); })
        .catch((error) => { const message = error instanceof Error ? error.message : 'Stage layout save failed'; setLayoutError(message); setSaveState('error'); onStatus(message); });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [document, loaded, documentName]);

  function updateScene(change: (scene: StageSceneLayout) => StageSceneLayout) {
    if (!activeScene) return;
    setDocument((current) => ({ ...current, scenes: current.scenes.map((scene) => scene.id === activeScene.id ? { ...change(scene), updatedAt: new Date().toISOString() } : scene) }));
  }

  function addShape(type: StageShapeType) {
    if (!activeScene) return; const preset = shapeDefaults[type]; const offset = activeScene.shapes.length % 8 * 18;
    const shape: StageShape = { id: localId(), type, x: 190 + offset, y: 150 + offset, width: preset.width, height: preset.height, label: preset.label, color: preset.color, rotation: 0 };
    updateScene((scene) => ({ ...scene, shapes: [...scene.shapes, shape] })); setSelectedShapeId(shape.id);
  }

  function updateShape(change: Partial<StageShape>) { updateScene((scene) => ({ ...scene, shapes: scene.shapes.map((shape) => shape.id === selectedShapeId ? { ...shape, ...change } : shape) })); }
  function removeShape() { updateScene((scene) => ({ ...scene, shapes: scene.shapes.filter((shape) => shape.id !== selectedShapeId) })); setSelectedShapeId(''); }
  function duplicatePrevious() {
    if (!activeScene) return; const previous = document.scenes[activeScene.order - 1];
    if (!previous) { onStatus('There is no previous scene layout to duplicate.'); return; }
    updateScene((scene) => ({ ...scene, shapes: previous.shapes.map((shape) => ({ ...shape, id: localId() })) })); onStatus(`Copied layout from ${previous.heading}`);
  }

  function point(event: ReactPointerEvent<SVGSVGElement>) { const box = svg.current!.getBoundingClientRect(); return { x: (event.clientX - box.left) / box.width * 1000, y: (event.clientY - box.top) / box.height * 650 }; }
  function beginDrag(event: ReactPointerEvent<SVGElement>, shape: StageShape) {
    event.stopPropagation(); setSelectedShapeId(shape.id); const location = point(event as unknown as ReactPointerEvent<SVGSVGElement>);
    drag.current = { id: shape.id, pointerX: location.x, pointerY: location.y, shapeX: shape.x, shapeY: shape.y }; svg.current?.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag.current) return; const location = point(event); const active = drag.current;
    setSelectedShapeId(active.id); updateScene((scene) => ({ ...scene, shapes: scene.shapes.map((shape) => shape.id === active.id ? { ...shape, x: Math.max(0, Math.min(1000 - shape.width, active.shapeX + location.x - active.pointerX)), y: Math.max(0, Math.min(650 - shape.height, active.shapeY + location.y - active.pointerY)) } : shape) }));
  }

  if (!sceneLines.length) return <section className="stage-layout-empty"><h2>Stage Layout</h2><p>Add a Fountain scene heading before creating a layout.</p></section>;
  return <main className="stage-layout-workspace">
    <aside className="stage-scenes"><small>SCENE LAYOUTS</small><h2>Blocking & Set</h2><select value={activeScene?.id || ''} onChange={(event) => { setSelectedSceneId(event.target.value); setSelectedShapeId(''); }}>{document.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.sceneNumber ? `${scene.sceneNumber} · ` : ''}{scene.heading}</option>)}</select><button onClick={duplicatePrevious}>Duplicate previous scene</button><div className="stage-scene-list">{document.scenes.map((scene) => <button className={scene.id === activeScene?.id ? 'active' : ''} key={scene.id} onClick={() => { setSelectedSceneId(scene.id); setSelectedShapeId(''); }}><b>{scene.order + 1}</b><span>{scene.heading}<small>{scene.shapes.length} items</small></span></button>)}</div></aside>
    <section className="stage-designer"><header><div><small>ACTIVE SCENE</small><h2>{activeScene?.heading}</h2><span className={`stage-save-state ${saveState}`}>{saveState === 'loading' ? 'Loading layout…' : saveState === 'pending' ? 'Changes waiting to save…' : saveState === 'saving' ? 'Saving layout…' : saveState === 'error' ? `Layout error: ${layoutError}` : 'Layout saved on NAS'}</span></div><div className="shape-tools">{(['rectangle','circle','line','label','light','actor'] as StageShapeType[]).map((type) => <button key={type} onClick={() => addShape(type)}>+ {shapeDefaults[type].label}</button>)}</div></header>
      <div className="stage-canvas-wrap"><svg ref={svg} className="stage-canvas" viewBox="0 0 1000 650" onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onPointerDown={() => setSelectedShapeId('')}><defs><pattern id="stage-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" fill="none" stroke="currentColor" strokeOpacity=".11" /></pattern></defs><rect width="1000" height="650" className="stage-floor"/><rect width="1000" height="650" fill="url(#stage-grid)"/><text x="500" y="28" className="stage-orientation">UPSTAGE</text><text x="500" y="635" className="stage-orientation">AUDIENCE / DOWNSTAGE</text>{activeScene?.shapes.map((shape) => <g key={shape.id} className={shape.id === selectedShapeId ? 'selected' : ''} transform={`rotate(${shape.rotation} ${shape.x + shape.width / 2} ${shape.y + shape.height / 2})`} onPointerDown={(event) => beginDrag(event, shape)}>{shape.type === 'circle' || shape.type === 'light' || shape.type === 'actor' ? <ellipse cx={shape.x + shape.width / 2} cy={shape.y + shape.height / 2} rx={shape.width / 2} ry={shape.height / 2} fill={shape.color} /> : shape.type === 'line' ? <line x1={shape.x} y1={shape.y} x2={shape.x + shape.width} y2={shape.y + shape.height} stroke={shape.color} strokeWidth="8" /> : <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.type === 'label' ? 8 : 3} fill={shape.color} />}<text x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} className="shape-label">{shape.label}</text></g>)}</svg></div>
    </section>
    <aside className="stage-properties"><small>PROPERTIES</small><h2>{activeShape ? activeShape.label : 'Select an item'}</h2>{activeShape ? <div><label>Label<input value={activeShape.label} onChange={(event) => updateShape({ label: event.target.value })} /></label><label>Color<input type="color" value={activeShape.color} onChange={(event) => updateShape({ color: event.target.value })} /></label><label>Width<input type="number" min="10" value={Math.round(activeShape.width)} onChange={(event) => updateShape({ width: Math.max(10, Number(event.target.value)) })} /></label><label>Height<input type="number" min="4" value={Math.round(activeShape.height)} onChange={(event) => updateShape({ height: Math.max(4, Number(event.target.value)) })} /></label><label>Rotation<input type="number" min="-180" max="180" value={activeShape.rotation} onChange={(event) => updateShape({ rotation: Number(event.target.value) })} /></label><button className="danger" onClick={removeShape}>Delete item</button></div> : <p>Choose a shape on the stage, or add one from the toolbar.</p>}</aside>
  </main>;
}
