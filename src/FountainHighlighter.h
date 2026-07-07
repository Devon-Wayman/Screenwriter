#pragma once

#include <QSyntaxHighlighter>
#include <QTextCharFormat>

enum class FountainColorTheme {
    Standard,
    Warm,
    HighContrastLight,
    HighContrastDark,
    OneDarkDarker
};

class FountainHighlighter : public QSyntaxHighlighter {
    Q_OBJECT

public:
    explicit FountainHighlighter(QTextDocument *parent = nullptr);
    void setColorTheme(FountainColorTheme theme);

protected:
    void highlightBlock(const QString &text) override;

private:
    void configureFormats(FountainColorTheme theme);

    QTextCharFormat titleFormat;
    QTextCharFormat sceneFormat;
    QTextCharFormat characterFormat;
    QTextCharFormat dialogueFormat;
    QTextCharFormat parentheticalFormat;
    QTextCharFormat transitionFormat;
    QTextCharFormat sectionFormat;
    QTextCharFormat noteFormat;
    QTextCharFormat synopsisFormat;
    QTextCharFormat lyricFormat;
    QTextCharFormat pageBreakFormat;
};
