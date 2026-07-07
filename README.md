# Screenwriter

A native C++/Qt Fountain editor for screenplays, stageplays, and related script formats.

## Features

- Split workspace: raw Fountain editor on the left, live analysis on the right.
- Fountain-aware syntax highlighting for title pages, scene headings, characters, dialogue, transitions, notes, sections, synopses, lyrics, and page breaks.
- Live diagnostics with one-click corrections for common Fountain formatting issues.
- Character extraction with dialogue word counts, scene counts, and rough screen/stage time estimates.
- Editor search with next/previous navigation, wraparound, case-sensitive mode, and match counts.
- Scene navigation with a live **Navigate > Scenes** menu plus next/previous scene commands.
- PDF export for formatted screenplay/stageplay output, with an option to add the current synopsis/report as the first page.
- Optional local Ollama synopsis generation for the selected character, using multi-pass analysis across every relevant scene.
- Optional local Ollama whole-script reports with synopsis, rating recommendation, rating basis, runtime estimate, audience fit, character balance, and revision notes. Long scripts are analyzed in chunks first, then synthesized into a final report.

## Build

```sh
cmake -S . -B build
cmake --build build
```

Run on macOS:

```sh
open build/Screenwriter.app
```

Or run the executable directly:

```sh
./build/Screenwriter.app/Contents/MacOS/Screenwriter
```

## Platform Builds

macOS:

```sh
./scripts/build-macos.sh
```

Linux:

```sh
./scripts/build-linux.sh
```

Windows, from a Qt-enabled PowerShell or Developer PowerShell:

```powershell
.\scripts\build-windows.ps1
```

The scripts create release builds under `build/` and stage deployable files under `dist/`. On macOS the script uses `macdeployqt` when available. On Windows the script uses `windeployqt` when available.

## Preferences

Screenwriter stores user preferences with Qt `QSettings`, which uses the native settings location for each OS:

- macOS: app preferences, usually under `~/Library/Preferences`
- Windows: user settings, commonly the registry-backed Qt location
- Linux: config files under the user config directory, commonly `~/.config`

The app remembers the last opened file, editor text size, selected color theme, Ollama model name, window geometry, and the screenplay/analysis divider position.

## Ollama

The app checks for Ollama when it starts. If Ollama is missing, use **Install Ollama** in the right panel. If Homebrew is available, the app runs `brew install ollama`; otherwise it opens the Ollama download page.

Once Ollama is installed and running, use the model dropdown to choose a recommended local model. Missing models are shown as not installed; selecting one or pressing **Install Model** compares the packaged model recommendations against the current system's detected OS, CPU architecture, and memory before downloading with Ollama. The default is:

```sh
ollama pull llama3.1
```

Recommended test models include `llama3.1`, `qwen3:8b`, `qwen3:14b`, and `qwen3:30b`.

The app calls `http://localhost:11434/api/generate` only when you press **Synopsis**.
Use **Character Synopsis** for the selected character or **Script Report** for the whole screenplay/stageplay.

## PDF Export

Use **File > Export PDF...** to export the current Fountain document as a formatted PDF. Use **File > Export PDF with Synopsis...** to place the current synopsis/report panel on the first page, followed by the formatted script.

## Accessibility

Use **View > Larger Text**, **Smaller Text**, or **Reset Text Size** to adjust the editor. **View > Color Theme** includes Standard, Warm Low Glare, High Contrast Light, High Contrast Dark, and One Dark Darker presets.
