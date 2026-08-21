# Screenwriter

Screenwriter is a self-hosted, browser-based Fountain 1.1 editor designed for writing screenplays remotely while keeping the source files on storage you control. It runs as a React application with a small Express file API and is packaged as a single Docker container for NAS deployment.

Screenplays remain ordinary `.fountain` text files. There is no proprietary project database or cloud account requirement.

## Features

### Writing

- Fountain 1.1 syntax highlighting with customizable colors
- Focus Mode with a full-window writing surface
- Smart Enter and Tab screenplay navigation
- Application-owned undo and redo history
- Search, scene navigation, adjustable text size, and multiple themes
- In-app Fountain and keyboard guide with animated examples

### Fountain 1.1

- Scene headings, action, characters, dialogue, and parentheticals
- Forced scene, character, action, and transition elements
- Dual dialogue
- Notes, boneyards, sections, and synopses
- Lyrics, centered text, emphasis, escapes, and page breaks
- Multiline title-page metadata and explicit scene numbers
- Live diagnostics with one-click corrections

### Analysis

- Scene, character, and word counts
- Dialogue totals by character
- Character scene counts and estimated speaking time
- Estimated screenplay runtime
- Optional Ollama screenplay critique with automatic NAS discovery
- Saved custom Ollama endpoint and model selection for Tailscale fallbacks
- Consistent evidence-based reports covering structure, characters, dialogue, pacing, continuity, themes, production feasibility, and priority revisions
- Unofficial MPAA-style content-rating estimate with category-specific reasoning
- Persistent revision reports identified by screenplay fingerprint, model, and analysis date
- Scene-boundary chunk analysis with compact evidence summaries and a rolling continuity ledger
- Per-screenplay production formats for stage, feature film, short film, television, and audio drama
- Production constraints for runtime, audience, budget, cast, available locations, stage dimensions, equipment, and effects

### Files and output

- NAS-backed `.fountain` and `.txt` file library
- Atomic server-side saves
- Safe import that preserves an existing same-named NAS file
- Fountain source downloads
- Selectable-text screenplay PDFs
- Per-scene stage diagrams with selectable layout pages, either appended to the screenplay or exported as a separate PDF
- Optional analysis reports appended to screenplay PDFs for revision comparison
- Selectable and separately exportable analysis reports
- Automatic `(MORE)` and `(CONT'D)`, revision colors and marks, headers, footers, and watermarks
- US Letter and A4 PDF output
- Title pages, pagination, inline emphasis, dual-dialogue columns, and optional scene numbers

## Technology

- React and TypeScript
- Vite
- Express
- jsPDF
- Vitest
- Docker using Node 22 Alpine

## Quick start

Requirements:

- Node.js 22 or newer
- npm

Install and run the development servers:

```sh
npm install
npm run dev
```

Open `http://localhost:5173`. Vite serves the client and proxies `/api` to the Express server on port `3000`.

Run tests and create a production build:

```sh
npm test
npm run build
```

Run the compiled production server:

```sh
npm start
```

## Docker

Start with Docker Compose:

```sh
docker compose up -d --build
```

Open `http://localhost:3000`. The included Compose file stores screenplays in `./screenplays` on the host:

```yaml
ports:
  - "3000:3000"
volumes:
  - ./screenplays:/data
```

For an existing NAS share, change the host side of the mount:

```yaml
volumes:
  - /path/on/nas/screenplays:/data
```

The container uses these environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `3000` | HTTP port inside the container |
| `SCREENWRITER_DATA_DIR` | `/data` | Persistent Fountain storage location |
| `APP_VERSION` | Docker build argument | Version reported by `/api/health` |
| `OLLAMA_URLS` | empty | Optional comma-separated Ollama endpoints checked before automatic discovery |

## Ollama screenplay analysis

Open the **AI** tab in the analysis sidebar. Screenwriter checks, in order:

1. Addresses supplied through `OLLAMA_URLS`
2. `http://ollama:11434` for a container reachable by that name
3. `http://host.docker.internal:11434` for an Ollama port published by the NAS
4. The custom fallback saved through **AI → Settings**

The endpoint and preferred model are stored in `/data/ollama-settings.json`, alongside the persistent screenplay volume. Screenwriter communicates with Ollama from its Express server, so endpoint access and screenplay contents do not pass through the browser.

Long screenplays are analyzed sequentially in scene-boundary chunks. Each chunk produces a compact evidence record and continuity state using an 8K context; a final 16K synthesis combines those records into the saved report. This lowers peak inference memory compared with sending an entire feature screenplay through one large context. It takes more total inference time, but requests are deliberately sequential so they do not compete for memory. Character cues and scene headings from the Fountain parser ground every stage.

During analysis, the server streams newline-delimited progress events to the browser. The AI panel reports the active chunk, completed and remaining chunk counts, final synthesis, failures, and report completion. Proxy buffering is disabled for this response so progress can pass through a typical NAS reverse proxy promptly.

Choose a production format in the AI panel before analysis. The selection persists in `/data/document-settings.json`, appears in revision reports, and changes the production guidance supplied to every chunk. Stage reports treat written locations as potentially reusable or representational scenery, props, lighting, projection, and sound rather than assuming separate filming locations. Film and television reports instead consider physical locations, sets, permits, company moves, coverage, and shooting logistics.

For separate CasaOS apps, make sure Ollama publishes port `11434` to the NAS. The Compose configuration maps `host.docker.internal` to the Linux Docker host gateway. Alternatively, place both containers on a shared Docker network and set:

```yaml
environment:
  OLLAMA_URLS: http://ollama:11434
```

For a Tailscale-connected laptop, enter `http://100.x.y.z:11434` in AI settings. Ollama on that laptop must listen on the Tailscale interface rather than localhost, and its firewall and Tailnet ACL must permit the NAS to reach TCP port `11434`. Do not expose Ollama directly to the public internet.

## CasaOS and remote access

Screenwriter can be built locally on a CasaOS NAS and installed as a customized application. A typical configuration publishes container port `3000` as host port `3420` and mounts:

```text
/DATA/AppData/screenwriter/screenplays -> /data
```

Keep the service private to the LAN or a Tailnet. Screenwriter does not currently provide its own user authentication, so do not expose its port directly to the public internet.

Tailscale users can open it through the NAS MagicDNS name or Tailscale address:

```text
http://parents-nas:3420
http://100.x.y.z:3420
```

## NAS update workflow

Copy the deployment template once:

```sh
cp .env.deploy.example .env.deploy.local
```

Fill in the NAS host, SSH user, remote source directory, CasaOS Compose path, service name, image tag, and published port. `.env.deploy.local` is ignored by Git. Use SSH keys or Tailscale SSH; never place a password in the file.

Check connectivity:

```sh
./scripts/update-nas.sh --check
```

Deploy a patch release:

```sh
./scripts/update-nas.sh
```

The updater:

1. Checks SSH connectivity.
2. Reads the local and deployed semantic versions.
3. Increments the newer version.
4. Synchronizes source files with `rsync`.
5. Builds the image on the NAS.
6. Recreates the CasaOS service.
7. Verifies the expected version through `/api/health`.
8. Restores the previous Docker image if health verification fails.

Version controls:

```sh
./scripts/update-nas.sh             # patch: 0.1.2 -> 0.1.3
./scripts/update-nas.sh --minor     # minor: 0.1.3 -> 0.2.0
./scripts/update-nas.sh --major     # major: 0.2.0 -> 1.0.0
./scripts/update-nas.sh --no-bump   # rebuild the current version
```

When `NAS_USE_SUDO=1`, the deployment connection allocates a terminal so the NAS can request its sudo password. Set it to `0` only when the NAS user can already run Docker without sudo.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Save | `Command/Ctrl+S` |
| Find | `Command/Ctrl+F` |
| Undo | `Command/Ctrl+Z` |
| Redo | `Command/Ctrl+Shift+Z` or `Ctrl+Y` |
| Focus Mode | `Command/Ctrl+Shift+F` |
| Help | `F1` |
| Literal line break | `Shift+Enter` |

Smart Tab behavior:

- On a blank line, Tab begins a forced character cue with `@`.
- Repeated Tab before typing cycles character `@`, action `!`, scene `.`, and transition `>`.
- After a character or dialogue line, Tab inserts a parenthetical and places the cursor inside it.
- Elsewhere, Tab inserts four spaces for intentional action indentation.

## Storage and backups

The Docker mount at `/data` is the source of truth for saved screenplays. Importing a local Fountain file immediately copies it there. If the filename already exists, the import receives a numbered name instead of overwriting the stored file.

Stage layouts are available from the **Stage Layout** workspace tab. Each Fountain scene heading receives its own diagram, where set pieces, boundaries, labels, lights, and actors can be placed and labeled. Layouts autosave as editable vector data in JSON sidecars beneath `/data/stage-layouts`; the Fountain screenplay remains plain text and portable. The canvas is rendered as SVG in the browser, but separate `.svg` image files are not generated. Numbered scenes keep layouts associated more reliably when scenes are reordered, while unnumbered scenes are matched by heading and position.

Renaming a screenplay currently starts a new layout sidecar. Rename the corresponding file in `/data/stage-layouts` as well if an existing layout must follow a manually renamed screenplay.

Include the host screenplay directory in NAS snapshots and off-device backups. A NAS copy alone is not protection against disk failure, accidental deletion, or hardware loss.

## Autosave and recovery

Screenwriter autosaves edited documents every 60 seconds by default. The interval can be changed or disabled under **File → Revision history**. Each autosave writes the current Fountain file atomically and stores a content-addressed recovery snapshot beneath `/data/.revisions`. Identical content is not duplicated.

The default retention is 20 snapshots per screenplay and can be configured from 5 to 100. Loading a historical snapshot changes only the editor and marks the document as modified; it does not overwrite the current NAS file until **Save** is explicitly used. This provides a safe opportunity to review or export an older draft first.

## Current limitations

- No built-in authentication or multi-user permissions
- No offline synchronization yet
- No real-time collaborative editing
- No Final Draft `.fdx` import/export
- Page locking across major production revisions is not yet supported
- Fine-grained per-line revision tracking is not yet available; PDF revision colors and marks apply to the exported draft
- Undo history is limited to the active browser session, while autosave recovery snapshots persist on the NAS
- Stage layouts currently provide basic placement and property controls; resizing handles, layout undo/redo, and printable diagrams are planned

## Theme attributions

The shipped One Dark Darker palette is adapted from Joel Crosby's One Dark Darker VS Code extension. Visual Studio Dark and Light consolidate equivalent palettes contributed by Microsoft's C# and C/C++ extensions. PowerShell ISE is adapted from Microsoft's PowerShell VS Code extension. Only color values are represented; extension code and artwork are not included.

## License

No project license has been selected yet. Add a `LICENSE` file before advertising the repository as open source or accepting outside contributions.
