import { useEffect, useState } from 'react';

interface HelpModalProps { onClose: () => void }
type HelpTab = 'start' | 'syntax' | 'keys';

const demos = [
  { title: 'Create a scene', keys: ['INT.', 'Enter', 'Enter'], text: 'INT. KITCHEN - NIGHT\n\nRain ticks against the window.' },
  { title: 'Write dialogue', keys: ['Tab', 'Type character', 'Enter'], text: '@MARA\nI knew you would come back.' },
  { title: 'Add a parenthetical', keys: ['Tab after dialogue'], text: '@MARA\nI knew you would come back.\n(under her breath)\nI just hoped it would be sooner.' },
  { title: 'Write dual dialogue', keys: ['^ after second character'], text: 'MARA\nRun!\n\nJONAH ^\nWait!' },
];

function AnimatedHelpDemo() {
  const [demoIndex, setDemoIndex] = useState(0);
  const [characters, setCharacters] = useState(0);
  const demo = demos[demoIndex];

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) { setCharacters(demo.text.length); return; }
    if (characters < demo.text.length) {
      const timer = window.setTimeout(() => setCharacters((value) => value + 1), 38);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => { setDemoIndex((value) => (value + 1) % demos.length); setCharacters(0); }, 1600);
    return () => window.clearTimeout(timer);
  }, [characters, demo.text]);

  return <div className="help-demo">
    <div className="help-demo-heading"><div><small>LIVE EXAMPLE</small><strong>{demo.title}</strong></div><div>{demo.keys.map((key) => <kbd key={key}>{key}</kbd>)}</div></div>
    <pre>{demo.text.slice(0, characters)}<i aria-hidden="true" /></pre>
    <div className="demo-dots">{demos.map((item, index) => <button key={item.title} className={index === demoIndex ? 'active' : ''} onClick={() => { setDemoIndex(index); setCharacters(0); }} aria-label={`Show ${item.title}`} />)}</div>
  </div>;
}

export default function HelpModal({ onClose }: HelpModalProps) {
  const [tab, setTab] = useState<HelpTab>('start');
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <header><div><small>SCREENWRITER GUIDE</small><h2 id="help-title">Write naturally in Fountain</h2><p>Everything you need to format a screenplay without leaving the keyboard.</p></div><button onClick={onClose} aria-label="Close help">×</button></header>
    <nav aria-label="Help topics"><button className={tab === 'start' ? 'active' : ''} onClick={() => setTab('start')}>Quick start</button><button className={tab === 'syntax' ? 'active' : ''} onClick={() => setTab('syntax')}>Fountain 1.1</button><button className={tab === 'keys' ? 'active' : ''} onClick={() => setTab('keys')}>Keyboard</button></nav>
    <div className="help-body">
      <div className="help-copy">
        {tab === 'start' && <>
          <h3>A screenplay is still plain text</h3><p>Leave a blank line between screenplay elements. Screenwriter recognizes what you type, colors it, and formats it later for PDF.</p>
          <div className="help-steps"><article><b>1</b><div><strong>Set the location</strong><p>Start with <code>INT.</code>, <code>EXT.</code>, or <code>INT./EXT.</code>, then add the location and time.</p></div></article><article><b>2</b><div><strong>Describe what happens</strong><p>Action is ordinary sentence-case text separated by blank lines.</p></div></article><article><b>3</b><div><strong>Let someone speak</strong><p>Put an uppercase character cue on its own line. Dialogue follows immediately below it.</p></div></article></div>
          <aside className="help-callout"><strong>Fastest dialogue workflow</strong><p>On a blank line, press <kbd>Tab</kbd>, type the character name after <code>@</code>, then press <kbd>Enter</kbd> and write the dialogue.</p></aside>
          <aside className="help-callout"><strong>Screenplay spell checking</strong><p>Right-click a red-underlined word for corrections or to add a name, location, or production term to this screenplay's dictionary. Review accepted words under <strong>File → Screenplay dictionary</strong>.</p></aside>
        </>}
        {tab === 'syntax' && <>
          <h3>Fountain 1.1 reference</h3><div className="syntax-reference">
            <article><code>INT. HOUSE - DAY</code><span><strong>Scene heading</strong>Interior, exterior, or a forced heading beginning with <code>.</code></span></article>
            <article><code>MARA</code><span><strong>Character</strong>Uppercase on its own line. Use <code>@Mara</code> to force a cue.</span></article>
            <article><code>(whispering)</code><span><strong>Parenthetical</strong>A brief performance direction inside dialogue.</span></article>
            <article><code>Plain sentence text.</code><span><strong>Action</strong>What the audience sees or hears. Prefix with <code>!</code> to force action.</span></article>
            <article><code>CUT TO:</code><span><strong>Transition</strong>End in <code>TO:</code>, or prefix any transition with <code>&gt;</code>.</span></article>
            <article><code>JONAH ^</code><span><strong>Dual dialogue</strong>Add <code>^</code> to the second character cue.</span></article>
            <article><code>[[ private note ]]</code><span><strong>Note</strong>Visible while writing; omitted from the PDF.</span></article>
            <article><code>/* alternate scene */</code><span><strong>Boneyard</strong>Keep removed material without printing it.</span></article>
            <article><code># Act One</code><span><strong>Section</strong>Use more <code>#</code> characters for nested structure.</span></article>
            <article><code>= The plan goes wrong.</code><span><strong>Synopsis</strong>An outline note associated with the following scene.</span></article>
            <article><code>~Song lyric</code><span><strong>Lyric</strong>A line intended to be sung.</span></article>
            <article><code>&gt; THE END &lt;</code><span><strong>Centered text</strong>Centers the enclosed text in formatted output.</span></article>
            <article><code>===</code><span><strong>Page break</strong>Forces the following element onto a new PDF page.</span></article>
            <article><code>*italic* **bold** _underline_</code><span><strong>Emphasis</strong>May be combined; escape a marker with <code>\</code>.</span></article>
          </div>
        </>}
        {tab === 'keys' && <>
          <h3>Keyboard shortcuts</h3><div className="shortcut-reference">
            <article><span><kbd>Enter</kbd></span><p><strong>Advance intelligently</strong>Adds Fountain spacing after scenes, action, dialogue, and transitions; continues directly after characters and parentheticals.</p></article>
            <article><span><kbd>Shift</kbd><i>+</i><kbd>Enter</kbd></span><p><strong>Literal line break</strong>Always inserts exactly one newline.</p></article>
            <article><span><kbd>Tab</kbd></span><p><strong>Start or change an element</strong>On a blank line starts <code>@</code>. Press repeatedly before typing to cycle <code>@</code>, <code>!</code>, <code>.</code>, and <code>&gt;</code>.</p></article>
            <article><span><kbd>Tab</kbd></span><p><strong>Add a parenthetical</strong>After a character or dialogue, inserts <code>()</code> and puts the cursor inside.</p></article>
            <article><span><kbd>⌘/Ctrl</kbd><i>+</i><kbd>Z</kbd></span><p><strong>Undo</strong>Restores text and cursor position. Add <kbd>Shift</kbd> to redo; <kbd>Ctrl</kbd>+<kbd>Y</kbd> also redoes.</p></article>
            <article><span><kbd>⌘/Ctrl</kbd><i>+</i><kbd>S</kbd></span><p><strong>Save</strong>Writes the current Fountain file to NAS storage.</p></article>
            <article><span><kbd>⌘/Ctrl</kbd><i>+</i><kbd>F</kbd></span><p><strong>Find</strong>Searches inside the active screenplay.</p></article>
            <article><span><kbd>⌘/Ctrl</kbd><i>+</i><kbd>Shift</kbd><i>+</i><kbd>F</kbd></span><p><strong>Focus Mode</strong>Enters the full-window writing surface. Press <kbd>Esc</kbd> to leave.</p></article>
          </div>
        </>}
      </div>
      <AnimatedHelpDemo />
    </div>
    <footer><span>Press <kbd>F1</kbd> anywhere to reopen this guide.</span><button onClick={onClose}>Start writing</button></footer>
  </section></div>;
}
