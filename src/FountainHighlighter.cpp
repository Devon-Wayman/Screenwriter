#include "FountainHighlighter.h"

#include <QRegularExpression>

namespace {

QTextCharFormat makeFormat(const QColor &color, QFont::Weight weight = QFont::Normal, bool italic = false)
{
    QTextCharFormat fmt;
    fmt.setForeground(color);
    fmt.setFontWeight(weight);
    fmt.setFontItalic(italic);
    return fmt;
}

}

FountainHighlighter::FountainHighlighter(QTextDocument *parent): QSyntaxHighlighter(parent)
{
    configureFormats(FountainColorTheme::Standard);
}

void FountainHighlighter::setColorTheme(FountainColorTheme theme)
{
    configureFormats(theme);
    rehighlight();
}

void FountainHighlighter::configureFormats(FountainColorTheme theme)
{
    switch (theme) {
    case FountainColorTheme::Warm:
        titleFormat = makeFormat(QColor("#76520f"), QFont::DemiBold);
        sceneFormat = makeFormat(QColor("#006b6b"), QFont::Bold);
        characterFormat = makeFormat(QColor("#7847a8"), QFont::Bold);
        dialogueFormat = makeFormat(QColor("#26231f"));
        parentheticalFormat = makeFormat(QColor("#6f655d"), QFont::Normal, true);
        transitionFormat = makeFormat(QColor("#9c2b1e"), QFont::Bold);
        sectionFormat = makeFormat(QColor("#2457a6"), QFont::Bold);
        noteFormat = makeFormat(QColor("#6f655d"), QFont::Normal, true);
        synopsisFormat = makeFormat(QColor("#317246"), QFont::DemiBold);
        lyricFormat = makeFormat(QColor("#a73768"), QFont::DemiBold);
        pageBreakFormat = makeFormat(QColor("#746b62"), QFont::Bold);
        break;
    case FountainColorTheme::HighContrastLight:
        titleFormat = makeFormat(QColor("#5c3200"), QFont::Bold);
        sceneFormat = makeFormat(QColor("#004f59"), QFont::Bold);
        characterFormat = makeFormat(QColor("#4b0082"), QFont::Bold);
        dialogueFormat = makeFormat(QColor("#000000"));
        parentheticalFormat = makeFormat(QColor("#404040"), QFont::DemiBold, true);
        transitionFormat = makeFormat(QColor("#8b0000"), QFont::Bold);
        sectionFormat = makeFormat(QColor("#003da5"), QFont::Bold);
        noteFormat = makeFormat(QColor("#404040"), QFont::DemiBold, true);
        synopsisFormat = makeFormat(QColor("#005a24"), QFont::Bold);
        lyricFormat = makeFormat(QColor("#8a004f"), QFont::Bold);
        pageBreakFormat = makeFormat(QColor("#222222"), QFont::Bold);
        break;
    case FountainColorTheme::HighContrastDark:
        titleFormat = makeFormat(QColor("#ffd166"), QFont::Bold);
        sceneFormat = makeFormat(QColor("#72f2eb"), QFont::Bold);
        characterFormat = makeFormat(QColor("#d0a2ff"), QFont::Bold);
        dialogueFormat = makeFormat(QColor("#f7f7f7"));
        parentheticalFormat = makeFormat(QColor("#d6d6d6"), QFont::DemiBold, true);
        transitionFormat = makeFormat(QColor("#ff8a80"), QFont::Bold);
        sectionFormat = makeFormat(QColor("#9ecbff"), QFont::Bold);
        noteFormat = makeFormat(QColor("#d6d6d6"), QFont::DemiBold, true);
        synopsisFormat = makeFormat(QColor("#95f0b2"), QFont::Bold);
        lyricFormat = makeFormat(QColor("#ff9fd2"), QFont::Bold);
        pageBreakFormat = makeFormat(QColor("#ffffff"), QFont::Bold);
        break;
    case FountainColorTheme::OneDarkDarker:
        titleFormat = makeFormat(QColor("#e6a971"), QFont::DemiBold);
        sceneFormat = makeFormat(QColor("#58c1cf"), QFont::Bold);
        characterFormat = makeFormat(QColor("#c162de"), QFont::Bold);
        dialogueFormat = makeFormat(QColor("#abb2bf"));
        parentheticalFormat = makeFormat(QColor("#7f848e"), QFont::Normal, true);
        transitionFormat = makeFormat(QColor("#e05561"), QFont::Bold);
        sectionFormat = makeFormat(QColor("#61afef"), QFont::Bold);
        noteFormat = makeFormat(QColor("#7f848e"), QFont::Normal, true);
        synopsisFormat = makeFormat(QColor("#98c379"), QFont::DemiBold);
        lyricFormat = makeFormat(QColor("#de73ff"), QFont::DemiBold);
        pageBreakFormat = makeFormat(QColor("#d7dae0"), QFont::Bold);
        break;
    case FountainColorTheme::Standard:
        titleFormat = makeFormat(QColor("#7a4f01"), QFont::DemiBold);
        sceneFormat = makeFormat(QColor("#0b6673"), QFont::Bold);
        characterFormat = makeFormat(QColor("#8a3ffc"), QFont::Bold);
        dialogueFormat = makeFormat(QColor("#1f2937"));
        parentheticalFormat = makeFormat(QColor("#6b7280"), QFont::Normal, true);
        transitionFormat = makeFormat(QColor("#b42318"), QFont::Bold);
        sectionFormat = makeFormat(QColor("#1d4ed8"), QFont::Bold);
        noteFormat = makeFormat(QColor("#6b7280"), QFont::Normal, true);
        synopsisFormat = makeFormat(QColor("#047857"), QFont::DemiBold);
        lyricFormat = makeFormat(QColor("#be185d"), QFont::DemiBold);
        pageBreakFormat = makeFormat(QColor("#71717a"), QFont::Bold);
        break;
    }
}

void FountainHighlighter::highlightBlock(const QString &text)
{
    const QString trimmed = text.trimmed();
    if (trimmed.isEmpty()) {
        return;
    }

    static const QRegularExpression titleKey(R"(^[A-Za-z][A-Za-z0-9 _-]*:\s*.+$)");
    static const QRegularExpression scene(R"(^\s*\.?\s*(INT|EXT|EST|INT\/EXT|INT\.\/EXT|I\/E)[\.\s].*)",
                                          QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression character(R"(^\s*[A-Z0-9][A-Z0-9 '\-\.]*(\s*\(.*\))?\^?\s*$)");

    if (titleKey.match(trimmed).hasMatch()) {
        setFormat(0, text.length(), titleFormat);
    } else if (scene.match(trimmed).hasMatch()) {
        setFormat(0, text.length(), sceneFormat);
    } else if (trimmed.startsWith('#')) {
        setFormat(0, text.length(), sectionFormat);
    } else if (trimmed.startsWith('=')) {
        setFormat(0, text.length(), synopsisFormat);
    } else if (trimmed == QStringLiteral("===")) {
        setFormat(0, text.length(), pageBreakFormat);
    } else if (trimmed.startsWith(QStringLiteral("[[")) || trimmed.startsWith(QStringLiteral("/*"))
               || trimmed.startsWith(QStringLiteral("*/"))) {
        setFormat(0, text.length(), noteFormat);
    } else if (trimmed.startsWith('~')) {
        setFormat(0, text.length(), lyricFormat);
    } else if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        setFormat(0, text.length(), parentheticalFormat);
    } else if (trimmed.endsWith(QStringLiteral(" TO:"))
               || trimmed == QStringLiteral("FADE IN:")
               || trimmed == QStringLiteral("FADE OUT:")) {
        setFormat(0, text.length(), transitionFormat);
    } else if (character.match(trimmed).hasMatch() && trimmed == trimmed.toUpper() && !trimmed.endsWith('.')) {
        setFormat(0, text.length(), characterFormat);
    } else {
        setFormat(0, text.length(), dialogueFormat);
    }
}
