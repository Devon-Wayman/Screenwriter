/// <reference types="vite/client" />

type ScreenwriterMenuCommand = 'new' | 'open' | 'save' | 'export-pdf' | 'export-fountain' | 'dictionary' | 'revisions' | 'undo' | 'redo';

interface Window {
  screenwriterMenu?: {
    onCommand(callback: (command: ScreenwriterMenuCommand) => void): () => void;
  };
}
