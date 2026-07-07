#pragma once

#include "Fountain.h"
#include "FountainHighlighter.h"

#include <QMainWindow>
#include <QNetworkAccessManager>
#include <QProcess>
#include <QSet>

class QLabel;
class QLineEdit;
class QListWidget;
class QPlainTextEdit;
class QPushButton;
class QCheckBox;
class QComboBox;
class QSplitter;
class QTableWidget;
class QTextEdit;
class QWidget;
class QAction;
class QMenu;

enum class VisualTheme {
    Standard,
    Warm,
    HighContrastLight,
    HighContrastDark,
    OneDarkDarker
};

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

protected:
    void closeEvent(QCloseEvent *event) override;

private slots:
    void newDocument();
    void openDocument();
    void saveDocument();
    void saveDocumentAs();
    void exportPdf();
    void exportPdfWithSynopsis();
    void analyze();
    void applySelectedFix();
    void checkOllama();
    void installOllama();
    void installRecommendedModel();
    void handleOllamaInstallFinished(int exitCode, QProcess::ExitStatus status);
    void handleModelInstallFinished(int exitCode, QProcess::ExitStatus status);
    void handleModelListReply();
    void handleModelSelection(int index);
    void generateSynopsis();
    void generateScriptReport();
    void handleOllamaReply();
    void increaseTextSize();
    void decreaseTextSize();
    void resetTextSize();
    void applyTheme(VisualTheme theme);
    void showFindBar();
    void hideFindBar();
    void findNext();
    void findPrevious();
    void updateFindMatches();
    void jumpToScene();
    void jumpToNextScene();
    void jumpToPreviousScene();

private:
    void buildUi();
    void fillSample();
    void loadSettings();
    void saveSettings();
    bool loadDocumentFromPath(const QString &path);
    void updateWindowTitle();
    int themeToSettingsValue(VisualTheme theme) const;
    VisualTheme themeFromSettingsValue(int value) const;
    void updateCharacterTable();
    void updateDiagnostics();
    void updateSceneMenu();
    void jumpToPosition(int position);
    void updateEditorFont();
    void updateOllamaControls(bool installed, bool modelPresent, const QString &message);
    void refreshModelDropdown();
    bool modelInstalled(const QString &model) const;
    QString modelHardwareNote(const QString &model) const;
    QStringList recommendedModels() const;
    QString ollamaExecutable() const;
    QString recommendedModel() const;
    bool startOllamaProcess(QProcess *process, const QStringList &arguments);
    bool saveToPath(const QString &path);
    bool maybeSave();
    bool writeScreenplayPdf(const QString &path);
    bool writeAnalyticsPdf(const QString &path);
    QString formattedScriptPdfHtml() const;
    QString formattedScriptHtml() const;
    QString analyticsPdfHtml() const;
    QString lineToHtml(const FountainLine &line) const;
    QString selectedCharacterName() const;
    QString characterPrompt(const QString &name) const;
    QString characterEvidenceText(const QString &name, int maxChars = 26000) const;
    QString finalCharacterPrompt(const QString &name, const QStringList &summaries) const;
    QString scriptReportPrompt() const;
    QString finalScriptReportPrompt(const QStringList &summaries) const;
    QString normalizeScriptReportResponse(const QString &response) const;
    void setAnalysisMarkdown(const QString &text);
    QString scriptWideExcerpt(int maxChars = 22000) const;
    QString sceneOutlineText(int limit = 80) const;
    QString estimatedRuntimeText() const;
    QString characterSummaryText(int limit = 8) const;
    QStringList scriptAnalysisChunks(int maxChars = 7000) const;
    QStringList characterAnalysisChunks(const QString &name, int maxChars = 7000) const;
    void startChunkedAnalysis(const QString &mode, const QString &subject, const QStringList &chunks);
    void sendNextAnalysisChunk();
    void sendFinalAnalysisRequest();
    void sendScriptReportRepairRequest(const QString &previousResponse);
    bool findText(QTextDocument::FindFlags flags);

    QPlainTextEdit *editor = nullptr;
    FountainHighlighter *highlighter = nullptr;
    QSplitter *mainSplitter = nullptr;
    QAction *standardThemeAction = nullptr;
    QAction *warmThemeAction = nullptr;
    QAction *contrastLightAction = nullptr;
    QAction *contrastDarkAction = nullptr;
    QAction *oneDarkDarkerAction = nullptr;
    QAction *nextSceneAction = nullptr;
    QAction *previousSceneAction = nullptr;
    QMenu *scenesMenu = nullptr;
    QWidget *findBar = nullptr;
    QLineEdit *findEdit = nullptr;
    QLabel *findCountLabel = nullptr;
    QCheckBox *caseSensitiveCheck = nullptr;
    QTableWidget *characterTable = nullptr;
    QListWidget *diagnosticsList = nullptr;
    QLabel *summaryLabel = nullptr;
    QLabel *ollamaStatusLabel = nullptr;
    QComboBox *modelCombo = nullptr;
    QPushButton *checkOllamaButton = nullptr;
    QPushButton *installOllamaButton = nullptr;
    QPushButton *installModelButton = nullptr;
    QPushButton *synopsisButton = nullptr;
    QPushButton *scriptReportButton = nullptr;
    QTextEdit *synopsisEdit = nullptr;
    QNetworkAccessManager network;
    QProcess ollamaInstallProcess;
    QProcess modelInstallProcess;
    FountainParser parser;
    FountainDocument currentDocument;
    QString currentPath;
    QSet<QString> installedOllamaModels;
    int editorPointSize = 15;
    bool ollamaModelReady = false;
    bool loadingSettings = false;
    QString activeAnalysisMode;
    QString activeAnalysisSubject;
    QStringList activeAnalysisChunks;
    QStringList activeAnalysisSummaries;
    int activeAnalysisIndex = 0;
    VisualTheme currentTheme = VisualTheme::Standard;
};
