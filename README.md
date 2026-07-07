# Screenwriter

A native C++/Qt Fountain editor for screenplays, stageplays, and related script formats.

## Features

- Split workspace: raw Fountain editor on the left, live analysis on the right.
- Fountain-aware syntax highlighting for title pages, scene headings, characters, dialogue, transitions, notes, sections, synopses, lyrics, and page breaks.
- Live diagnostics with one-click corrections for common Fountain formatting issues.
- Character extraction with dialogue word counts, scene counts, and rough screen/stage time estimates.
- Editor search with next/previous navigation, wraparound, case-sensitive mode, and match counts.
- Scene navigation with a live **Navigate > Scenes** menu plus next/previous scene commands.
- PDF export for formatted screenplay/stageplay output, plus a separate analytics PDF with synopsis/report text, character counts, estimated runtime, and parser corrections.
- Optional local Ollama synopsis generation for the selected character, using multi-pass analysis across every relevant scene.
- Optional local Ollama whole-script reports with synopsis, rating recommendation, rating basis, runtime estimate, audience fit, character balance, and revision notes. Long scripts are analyzed in chunks first, then synthesized into a final report.

## Build

The project uses CMake presets for shared configure/build settings:

```sh
cmake --preset linux-release
cmake --build --preset linux-release
```

Available presets are `windows-release`, `macos-release`, and `linux-release`.

## Platform Builds

macOS:

```sh
./scripts/build-macos.sh
```

Linux:

```sh
./scripts/build-linux.sh
```

Windows:

```powershell
.\scripts\build-windows.ps1
```

Windows prerequisites:

- Visual Studio with the **Desktop development with C++** workload.
- Qt 6 with the **MSVC 2022 64-bit** kit.
- CMake and Ninja in `PATH`.

The Windows script initializes the MSVC compiler environment automatically when run from a normal PowerShell. It looks for Qt in `Qt6_DIR`, `QTDIR`, and common `C:\Qt\...\msvc2022_64` locations. If Qt is somewhere else, pass it explicitly:

```powershell
.\scripts\build-windows.ps1 -QtDir C:\Qt\6.11.1\msvc2022_64
```

The scripts create release builds under `build/` and stage deployable files under `dist/`. On Windows, run `dist\windows\Screenwriter.exe`; the build-tree executable under `build\windows-release` is not bundled with Qt DLLs. On macOS the script uses `macdeployqt` when available. On Windows the script uses `windeployqt` when available.

## Preferences

Screenwriter stores user preferences in an explicit `userprefs.ini` file under Qt's per-user application config folder. This keeps preferences persistent without using the Windows registry and avoids shared machine-wide locations like `ProgramData` for per-user choices.

The app remembers the last opened file path, selected color theme, editor text size, Ollama model name, window geometry, and the screenplay/analysis divider position. On startup, if the last opened file path still exists, Screenwriter opens it automatically; otherwise it starts with the sample document.

Typical preference file locations are:

- Windows: `%LOCALAPPDATA%\Local\Screenwriter\userprefs.ini` or the equivalent Qt app config path for the current user.
- macOS: `~/Library/Preferences/Local/Screenwriter/userprefs.ini` or the equivalent Qt app config path.
- Linux: `~/.config/Local/Screenwriter/userprefs.ini` or the equivalent Qt app config path.

## Ollama

The app checks for Ollama when it starts. It first uses `PATH`, then checks common platform install locations: `%LOCALAPPDATA%\Programs\Ollama` and `Program Files` on Windows, Homebrew and `/Applications/Ollama.app` locations on macOS, and `/usr/local/bin`, `/usr/bin`, `/bin`, `/snap/bin`, and `~/.local/bin` on Linux. If Ollama is missing, use **Install Ollama** in the right panel. On macOS, if Homebrew is available, the app runs `brew install ollama`; otherwise it opens the Ollama download page.

Once Ollama is installed and running, use the model dropdown to choose a recommended local model. Missing models are shown as not installed; selecting one or pressing **Install Model** compares the packaged model recommendations against the current system's detected OS, CPU architecture, and memory before downloading with Ollama. The default is:

```sh
ollama pull llama3.1
```

Recommended test models include `llama3.1`, `qwen3:8b`, `qwen3:14b`, and `qwen3:30b`.

The app calls `http://localhost:11434/api/generate` only when you press **Synopsis**.
Use **Character Synopsis** for the selected character or **Script Report** for the whole screenplay/stageplay.

## PDF Export

Use **File > Export PDF...** to export only the current Fountain document as a formatted screenplay PDF. Use **File > Export Screenplay and Analytics PDFs...** to create two sibling files: the screenplay PDF you selected and a separate `-analytics.pdf` report containing the generated synopsis/report, parser metrics, character dialogue counts, estimated time, and corrections.

## Accessibility

Use **View > Larger Text**, **Smaller Text**, or **Reset Text Size** to adjust the editor. **View > Color Theme** includes Standard, Warm Low Glare, High Contrast Light, High Contrast Dark, and One Dark Darker presets.
