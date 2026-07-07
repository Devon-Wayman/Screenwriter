#include "Fountain.h"

#include <QMap>
#include <QRegularExpression>
#include <QSet>
#include <algorithm>

namespace {

const QRegularExpression sceneHeadingPattern(
    R"(^\s*\.?\s*(INT|EXT|EST|INT\/EXT|INT\.\/EXT|I\/E)[\.\s])",
    QRegularExpression::CaseInsensitiveOption);

const QRegularExpression likelySceneHeadingPattern(
    R"(^\s*\.?\s*(IN|ITN|EX|EXR|ENT|EXT|INT)[\.\s-])",
    QRegularExpression::CaseInsensitiveOption);

const QRegularExpression titleKeyPattern(R"(^[A-Za-z][A-Za-z0-9 _-]*:\s*.+$)");

}

FountainDocument FountainParser::parse(const QString &text) const
{
    FountainDocument document;
    const QStringList rawLines = text.split('\n');
    QMap<QString, CharacterStats> characterMap;
    QMap<QString, QSet<int>> characterScenes;

    bool inTitlePage = true;
    bool expectingDialogue = false;
    QString activeCharacter;
    int currentScene = -1;
    int offset = 0;
    int openNotes = 0;

    for (int i = 0; i < rawLines.size(); ++i) {
        const QString lineText = rawLines.at(i);
        const QString trimmed = lineText.trimmed();
        FountainLine line;
        line.index = i;
        line.start = offset;
        line.length = lineText.length();
        line.text = lineText;

        openNotes += lineText.count(QStringLiteral("[["));
        openNotes -= lineText.count(QStringLiteral("]]"));

        if (trimmed.isEmpty()) {
            line.type = FountainLineType::Empty;
            expectingDialogue = false;
            activeCharacter.clear();
        } else if (inTitlePage && titleKeyPattern.match(trimmed).hasMatch()) {
            line.type = FountainLineType::TitlePage;
        } else {
            inTitlePage = false;

            if (trimmed.startsWith(QStringLiteral("/*")) || trimmed.startsWith(QStringLiteral("*/"))
                || (trimmed.startsWith(QStringLiteral("[[")) && trimmed.endsWith(QStringLiteral("]]")))) {
                line.type = FountainLineType::Note;
            } else if (trimmed == QStringLiteral("===")) {
                line.type = FountainLineType::PageBreak;
            } else if (trimmed.startsWith('#')) {
                line.type = FountainLineType::Section;
            } else if (trimmed.startsWith('=')) {
                line.type = FountainLineType::Synopsis;
            } else if (trimmed.startsWith('~')) {
                line.type = FountainLineType::Lyric;
            } else if (trimmed.startsWith('>') && trimmed.endsWith('<')) {
                line.type = FountainLineType::Centered;
            } else if (isSceneHeading(trimmed)) {
                line.type = FountainLineType::SceneHeading;
                ++document.sceneCount;
                currentScene = document.sceneCount;
                expectingDialogue = false;
                activeCharacter.clear();
            } else if (isTransition(trimmed)) {
                line.type = FountainLineType::Transition;
                expectingDialogue = false;
                activeCharacter.clear();
            } else if (isCharacterCue(trimmed)) {
                line.type = FountainLineType::Character;
                activeCharacter = normalizedCharacterName(trimmed);
                line.character = activeCharacter;
                expectingDialogue = true;
                CharacterStats &stats = characterMap[activeCharacter];
                stats.name = activeCharacter;
                if (currentScene >= 0) {
                    characterScenes[activeCharacter].insert(currentScene);
                }
            } else if (expectingDialogue && trimmed.startsWith('(') && trimmed.endsWith(')')) {
                line.type = FountainLineType::Parenthetical;
                line.character = activeCharacter;
            } else if (expectingDialogue) {
                line.type = FountainLineType::Dialogue;
                line.character = activeCharacter;
                const int words = wordCount(trimmed);
                document.wordCount += words;
                CharacterStats &stats = characterMap[activeCharacter];
                stats.name = activeCharacter;
                stats.dialogueLines += 1;
                stats.dialogueWords += words;
                if (stats.sampleLines.size() < 5) {
                    stats.sampleLines.push_back(trimmed);
                }
            } else {
                line.type = FountainLineType::Action;
                document.wordCount += wordCount(trimmed);
            }
        }

        if (line.type == FountainLineType::Action && isLikelySceneHeading(trimmed)) {
            FountainDiagnostic diagnostic;
            diagnostic.line = i;
            diagnostic.start = line.start;
            diagnostic.length = line.length;
            diagnostic.message = QStringLiteral("Possible scene heading typo or missing INT./EXT. prefix.");
            diagnostic.replacement = trimmed.toUpper();
            if (diagnostic.replacement.startsWith(QStringLiteral("IN "))) {
                diagnostic.replacement.replace(0, 2, QStringLiteral("INT."));
            } else if (diagnostic.replacement.startsWith(QStringLiteral("EX "))) {
                diagnostic.replacement.replace(0, 2, QStringLiteral("EXT."));
            }
            document.diagnostics.push_back(diagnostic);
        }

        if (line.type == FountainLineType::Action && trimmed.size() > 2 && trimmed == trimmed.toUpper()
            && !trimmed.endsWith('.') && !trimmed.contains(':')) {
            FountainDiagnostic diagnostic;
            diagnostic.line = i;
            diagnostic.start = line.start;
            diagnostic.length = line.length;
            diagnostic.message = QStringLiteral("Uppercase action may be intended as a character cue.");
            diagnostic.replacement = trimmed;
            document.diagnostics.push_back(diagnostic);
        }

        if (line.type == FountainLineType::Transition && !trimmed.endsWith(':')) {
            FountainDiagnostic diagnostic;
            diagnostic.line = i;
            diagnostic.start = line.start;
            diagnostic.length = line.length;
            diagnostic.message = QStringLiteral("Transitions conventionally end with a colon.");
            diagnostic.replacement = trimmed + QStringLiteral(":");
            document.diagnostics.push_back(diagnostic);
        }

        document.lines.push_back(line);
        offset += lineText.length() + 1;
    }

    if (openNotes > 0) {
        FountainDiagnostic diagnostic;
        diagnostic.line = qMax(0, rawLines.size() - 1);
        diagnostic.start = qMax(0, text.length() - 1);
        diagnostic.length = 0;
        diagnostic.message = QStringLiteral("A note appears to be missing a closing ]].");
        diagnostic.replacement = QStringLiteral("]]");
        document.diagnostics.push_back(diagnostic);
    }

    for (auto it = characterMap.begin(); it != characterMap.end(); ++it) {
        CharacterStats stats = it.value();
        stats.sceneCount = characterScenes.value(it.key()).size();
        stats.estimatedSeconds = (stats.dialogueWords * 0.38) + (stats.sceneCount * 8.0);
        document.characters.push_back(stats);
    }

    std::sort(document.characters.begin(), document.characters.end(),
              [](const CharacterStats &left, const CharacterStats &right) {
                  if (left.estimatedSeconds == right.estimatedSeconds) {
                      return left.name < right.name;
                  }
                  return left.estimatedSeconds > right.estimatedSeconds;
              });

    return document;
}

QString FountainParser::normalizedCharacterName(QString cue)
{
    cue = cue.trimmed();
    cue.remove('^');
    cue.remove(QRegularExpression(R"(\s*\(.*\)\s*$)"));
    return cue.trimmed();
}

bool FountainParser::isSceneHeading(const QString &trimmed)
{
    return sceneHeadingPattern.match(trimmed).hasMatch();
}

bool FountainParser::isLikelySceneHeading(const QString &trimmed)
{
    return likelySceneHeadingPattern.match(trimmed).hasMatch();
}

bool FountainParser::isTransition(const QString &trimmed)
{
    static const QSet<QString> transitions = {
        QStringLiteral("CUT TO"),
        QStringLiteral("CUT TO:"),
        QStringLiteral("FADE IN"),
        QStringLiteral("FADE IN:"),
        QStringLiteral("FADE OUT"),
        QStringLiteral("FADE OUT:"),
        QStringLiteral("DISSOLVE TO"),
        QStringLiteral("DISSOLVE TO:"),
        QStringLiteral("SMASH CUT TO"),
        QStringLiteral("SMASH CUT TO:"),
        QStringLiteral("MATCH CUT TO"),
        QStringLiteral("MATCH CUT TO:")
    };
    const QString upper = trimmed.toUpper();
    return upper.endsWith(QStringLiteral(" TO:")) || transitions.contains(upper);
}

bool FountainParser::isCharacterCue(const QString &trimmed)
{
    if (trimmed.length() < 2 || trimmed.length() > 42) {
        return false;
    }
    if (trimmed.contains(':') || trimmed.endsWith('.') || trimmed.startsWith('>')) {
        return false;
    }
    const QString withoutDual = trimmed.endsWith('^') ? trimmed.left(trimmed.length() - 1).trimmed() : trimmed;
    if (withoutDual != withoutDual.toUpper()) {
        return false;
    }
    return withoutDual.contains(QRegularExpression(R"([A-Z0-9])"));
}

int FountainParser::wordCount(const QString &text)
{
    static const QRegularExpression words(R"(\b[\p{L}\p{N}']+\b)");
    int count = 0;
    auto match = words.globalMatch(text);
    while (match.hasNext()) {
        match.next();
        ++count;
    }
    return count;
}
