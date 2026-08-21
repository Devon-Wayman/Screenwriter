export type LineType = 'empty' | 'title' | 'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition' | 'section' | 'synopsis' | 'note' | 'boneyard' | 'lyric' | 'centered' | 'page-break';

export interface FountainLine { index: number; start: number; length: number; text: string; type: LineType; character?: string; dualDialogue?: boolean; forced?: boolean; sceneNumber?: string }
export interface CharacterStats { name: string; dialogueLines: number; dialogueWords: number; sceneCount: number; estimatedSeconds: number }
export interface Diagnostic { line: number; start: number; length: number; message: string; replacement: string }
export interface FountainDocument { lines: FountainLine[]; characters: CharacterStats[]; diagnostics: Diagnostic[]; sceneCount: number; wordCount: number; titlePage: Record<string, string> }
export interface DocumentInfo { name: string; updatedAt: string; size: number }
