#pragma once

#include <QString>
#include <QStringList>
#include <QVector>

enum class FountainLineType {
    Empty,
    TitlePage,
    SceneHeading,
    Action,
    Character,
    Parenthetical,
    Dialogue,
    Transition,
    Section,
    Synopsis,
    Note,
    Lyric,
    Centered,
    PageBreak
};

struct FountainLine {
    int index = 0;
    int start = 0;
    int length = 0;
    QString text;
    FountainLineType type = FountainLineType::Action;
    QString character;
};

struct CharacterStats {
    QString name;
    int dialogueLines = 0;
    int dialogueWords = 0;
    int sceneCount = 0;
    double estimatedSeconds = 0.0;
    QStringList sampleLines;
};

struct FountainDiagnostic {
    int line = 0;
    int start = 0;
    int length = 0;
    QString message;
    QString replacement;
};

struct FountainDocument {
    QVector<FountainLine> lines;
    QVector<CharacterStats> characters;
    QVector<FountainDiagnostic> diagnostics;
    int sceneCount = 0;
    int wordCount = 0;
};

class FountainParser {
public:
    FountainDocument parse(const QString &text) const;

private:
    static QString normalizedCharacterName(QString cue);
    static bool isSceneHeading(const QString &trimmed);
    static bool isLikelySceneHeading(const QString &trimmed);
    static bool isTransition(const QString &trimmed);
    static bool isCharacterCue(const QString &trimmed);
    static int wordCount(const QString &text);
};
