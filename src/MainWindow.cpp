#include "MainWindow.h"

#include "FountainHighlighter.h"

#include <QApplication>
#include <QActionGroup>
#include <QBrush>
#include <QCheckBox>
#include <QCloseEvent>
#include <QComboBox>
#include <QColor>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QFontDatabase>
#include <QHeaderView>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMenuBar>
#include <QMessageBox>
#include <QNetworkReply>
#include <QPlainTextEdit>
#include <QPrinter>
#include <QPushButton>
#include <QSaveFile>
#include <QSettings>
#include <QSplitter>
#include <QStatusBar>
#include <QStandardPaths>
#include <QStandardItemModel>
#include <QStandardItem>
#include <QSysInfo>
#include <QTableWidget>
#include <QTextCursor>
#include <QTextEdit>
#include <QTextDocument>
#include <QTextDocumentFragment>
#include <QTimer>
#include <QToolBar>
#include <QUrl>
#include <QVBoxLayout>
#include <QtMath>

#ifdef Q_OS_MACOS
#include <sys/sysctl.h>
#elif defined(Q_OS_LINUX)
#include <sys/sysinfo.h>
#elif defined(Q_OS_WIN)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace {

QString durationText(double seconds)
{
    const int rounded = qRound(seconds);
    const int minutes = rounded / 60;
    const int secs = rounded % 60;
    if (minutes == 0) {
        return QStringLiteral("%1s").arg(secs);
    }
    return QStringLiteral("%1m %2s").arg(minutes).arg(secs, 2, 10, QChar('0'));
}

bool hasRequiredRatingSections(const QString &text)
{
    const QString lower = text.toLower();
    return lower.contains(QStringLiteral("rating recommendation"))
           && lower.contains(QStringLiteral("what the rating is based on"));
}

QString htmlBodyContents(const QString &html)
{
    const QString lower = html.toLower();
    const int bodyStart = lower.indexOf(QStringLiteral("<body"));
    if (bodyStart < 0) {
        return html.trimmed();
    }

    const int bodyTagEnd = lower.indexOf(QLatin1Char('>'), bodyStart);
    const int bodyEnd = lower.lastIndexOf(QStringLiteral("</body>"));
    if (bodyTagEnd < 0 || bodyEnd <= bodyTagEnd) {
        return html.trimmed();
    }

    return html.mid(bodyTagEnd + 1, bodyEnd - bodyTagEnd - 1).trimmed();
}

double totalMemoryGb()
{
#ifdef Q_OS_MACOS
    quint64 bytes = 0;
    size_t size = sizeof(bytes);
    if (sysctlbyname("hw.memsize", &bytes, &size, nullptr, 0) == 0 && bytes > 0) {
        return static_cast<double>(bytes) / 1024.0 / 1024.0 / 1024.0;
    }
#elif defined(Q_OS_LINUX)
    struct sysinfo info;
    if (sysinfo(&info) == 0) {
        const double bytes = static_cast<double>(info.totalram) * static_cast<double>(info.mem_unit);
        return bytes / 1024.0 / 1024.0 / 1024.0;
    }
#elif defined(Q_OS_WIN)
    MEMORYSTATUSEX status;
    status.dwLength = sizeof(status);
    if (GlobalMemoryStatusEx(&status)) {
        return static_cast<double>(status.ullTotalPhys) / 1024.0 / 1024.0 / 1024.0;
    }
#endif
    return 0.0;
}

QJsonArray modelSpecs()
{
    QFile file(QStringLiteral(":/model_specs.json"));
    if (!file.open(QIODevice::ReadOnly)) {
        return {};
    }
    return QJsonDocument::fromJson(file.readAll()).object().value(QStringLiteral("models")).toArray();
}

QJsonObject modelSpec(const QString &model)
{
    const QJsonArray specs = modelSpecs();
    for (const QJsonValue &value : specs) {
        const QJsonObject object = value.toObject();
        if (object.value(QStringLiteral("name")).toString() == model) {
            return object;
        }
    }
    return {};
}

QString machineSummary(double memoryGb)
{
    QStringList parts;
    parts << QStringLiteral("System: %1").arg(QSysInfo::prettyProductName());
    parts << QStringLiteral("CPU architecture: %1").arg(QSysInfo::currentCpuArchitecture());
    parts << (memoryGb > 0.0
                  ? QStringLiteral("Detected memory: %1 GB").arg(QString::number(memoryGb, 'f', 1))
                  : QStringLiteral("Detected memory: unavailable"));
    parts << QStringLiteral("GPU memory: not automatically detected");
    return parts.join(QStringLiteral("\n"));
}

QString userPreferencesPath()
{
    QString configDir = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    if (configDir.isEmpty()) {
        configDir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    }
    if (configDir.isEmpty()) {
        configDir = QDir::home().filePath(QStringLiteral(".screenwriter"));
    }

    QDir().mkpath(configDir);
    return QDir(configDir).filePath(QStringLiteral("userprefs.ini"));
}

QString modelCompatibilityText(const QJsonObject &spec, double memoryGb)
{
    const double minimumRam = spec.value(QStringLiteral("minimumRamGb")).toDouble();
    const double recommendedRam = spec.value(QStringLiteral("recommendedRamGb")).toDouble();
    if (memoryGb <= 0.0 || minimumRam <= 0.0 || recommendedRam <= 0.0) {
        return QStringLiteral("Compatibility: Unknown. Memory information was not available.");
    }
    if (memoryGb >= recommendedRam) {
        return QStringLiteral("Compatibility: Strong. Detected memory meets or exceeds the recommendation.");
    }
    if (memoryGb >= minimumRam) {
        return QStringLiteral("Compatibility: Usable. Detected memory meets the minimum, but responses may be slower.");
    }
    return QStringLiteral("Compatibility: Not recommended. Detected memory is below the listed minimum.");
}

QString minutesText(double minutes)
{
    if (minutes < 1.0) {
        return QStringLiteral("<1 min");
    }
    if (minutes < 10.0) {
        return QStringLiteral("%1 min").arg(QString::number(minutes, 'f', 1));
    }
    return QStringLiteral("%1 min").arg(qRound(minutes));
}

QTableWidgetItem *item(const QString &text)
{
    auto *tableItem = new QTableWidgetItem(text);
    tableItem->setFlags(tableItem->flags() & ~Qt::ItemIsEditable);
    return tableItem;
}

}

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    buildUi();
    loadSettings();
    analyze();
}

void MainWindow::buildUi()
{
    setWindowTitle(QStringLiteral("Screenwriter"));
    resize(1220, 780);

    auto *fileMenu = menuBar()->addMenu(QStringLiteral("File"));
    auto *newAction = fileMenu->addAction(QStringLiteral("New"));
    newAction->setShortcut(QKeySequence::New);
    auto *openAction = fileMenu->addAction(QStringLiteral("Open..."));
    openAction->setShortcut(QKeySequence::Open);
    auto *saveAction = fileMenu->addAction(QStringLiteral("Save"));
    saveAction->setShortcut(QKeySequence::Save);
    auto *saveAsAction = fileMenu->addAction(QStringLiteral("Save As..."));
    saveAsAction->setShortcut(QKeySequence::SaveAs);
    fileMenu->addSeparator();
    auto *exportPdfAction = fileMenu->addAction(QStringLiteral("Export PDF..."));
    auto *exportPdfWithSynopsisAction = fileMenu->addAction(QStringLiteral("Export Screenplay and Analytics PDFs..."));

    auto *editMenu = menuBar()->addMenu(QStringLiteral("Edit"));
    auto *findAction = editMenu->addAction(QStringLiteral("Find"));
    findAction->setShortcut(QKeySequence::Find);
    auto *findNextAction = editMenu->addAction(QStringLiteral("Find Next"));
    findNextAction->setShortcut(QKeySequence::FindNext);
    auto *findPreviousAction = editMenu->addAction(QStringLiteral("Find Previous"));
    findPreviousAction->setShortcut(QKeySequence::FindPrevious);

    auto *navigateMenu = menuBar()->addMenu(QStringLiteral("Navigate"));
    scenesMenu = navigateMenu->addMenu(QStringLiteral("Scenes"));
    nextSceneAction = navigateMenu->addAction(QStringLiteral("Next Scene"));
    nextSceneAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+]")));
    previousSceneAction = navigateMenu->addAction(QStringLiteral("Previous Scene"));
    previousSceneAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+[")));

    auto *viewMenu = menuBar()->addMenu(QStringLiteral("View"));
    auto *largerTextAction = viewMenu->addAction(QStringLiteral("Larger Text"));
    largerTextAction->setShortcut(QKeySequence::ZoomIn);
    auto *smallerTextAction = viewMenu->addAction(QStringLiteral("Smaller Text"));
    smallerTextAction->setShortcut(QKeySequence::ZoomOut);
    auto *resetTextAction = viewMenu->addAction(QStringLiteral("Reset Text Size"));
    resetTextAction->setShortcut(QKeySequence(QStringLiteral("Ctrl+0")));
    auto *themeMenu = viewMenu->addMenu(QStringLiteral("Color Theme"));
    auto *themeGroup = new QActionGroup(this);
    themeGroup->setExclusive(true);
    standardThemeAction = themeMenu->addAction(QStringLiteral("Standard"));
    standardThemeAction->setCheckable(true);
    standardThemeAction->setChecked(true);
    standardThemeAction->setActionGroup(themeGroup);
    warmThemeAction = themeMenu->addAction(QStringLiteral("Warm Low Glare"));
    warmThemeAction->setCheckable(true);
    warmThemeAction->setActionGroup(themeGroup);
    contrastLightAction = themeMenu->addAction(QStringLiteral("High Contrast Light"));
    contrastLightAction->setCheckable(true);
    contrastLightAction->setActionGroup(themeGroup);
    contrastDarkAction = themeMenu->addAction(QStringLiteral("High Contrast Dark"));
    contrastDarkAction->setCheckable(true);
    contrastDarkAction->setActionGroup(themeGroup);
    oneDarkDarkerAction = themeMenu->addAction(QStringLiteral("One Dark Darker"));
    oneDarkDarkerAction->setCheckable(true);
    oneDarkDarkerAction->setActionGroup(themeGroup);

    auto *toolbar = addToolBar(QStringLiteral("File"));
    toolbar->setMovable(false);
    toolbar->addAction(newAction);
    toolbar->addAction(openAction);
    toolbar->addAction(saveAction);
    auto *analyzeAction = toolbar->addAction(QStringLiteral("Analyze"));

    connect(newAction, &QAction::triggered, this, &MainWindow::newDocument);
    connect(openAction, &QAction::triggered, this, &MainWindow::openDocument);
    connect(saveAction, &QAction::triggered, this, &MainWindow::saveDocument);
    connect(saveAsAction, &QAction::triggered, this, &MainWindow::saveDocumentAs);
    connect(exportPdfAction, &QAction::triggered, this, &MainWindow::exportPdf);
    connect(exportPdfWithSynopsisAction, &QAction::triggered, this, &MainWindow::exportPdfWithSynopsis);
    connect(analyzeAction, &QAction::triggered, this, &MainWindow::analyze);
    connect(findAction, &QAction::triggered, this, &MainWindow::showFindBar);
    connect(findNextAction, &QAction::triggered, this, &MainWindow::findNext);
    connect(findPreviousAction, &QAction::triggered, this, &MainWindow::findPrevious);
    connect(nextSceneAction, &QAction::triggered, this, &MainWindow::jumpToNextScene);
    connect(previousSceneAction, &QAction::triggered, this, &MainWindow::jumpToPreviousScene);
    connect(largerTextAction, &QAction::triggered, this, &MainWindow::increaseTextSize);
    connect(smallerTextAction, &QAction::triggered, this, &MainWindow::decreaseTextSize);
    connect(resetTextAction, &QAction::triggered, this, &MainWindow::resetTextSize);
    connect(standardThemeAction, &QAction::triggered, this, [this] { applyTheme(VisualTheme::Standard); });
    connect(warmThemeAction, &QAction::triggered, this, [this] { applyTheme(VisualTheme::Warm); });
    connect(contrastLightAction, &QAction::triggered, this, [this] { applyTheme(VisualTheme::HighContrastLight); });
    connect(contrastDarkAction, &QAction::triggered, this, [this] { applyTheme(VisualTheme::HighContrastDark); });
    connect(oneDarkDarkerAction, &QAction::triggered, this, [this] { applyTheme(VisualTheme::OneDarkDarker); });

    mainSplitter = new QSplitter(this);
    mainSplitter->setChildrenCollapsible(false);
    mainSplitter->setHandleWidth(12);
    mainSplitter->setOpaqueResize(true);
    mainSplitter->setStyleSheet(QStringLiteral(
        "QSplitter::handle { background: #c7cbd1; }"
        "QSplitter::handle:hover { background: #8f98a6; }"));

    auto *editorPane = new QWidget(mainSplitter);
    auto *editorLayout = new QVBoxLayout(editorPane);
    editorLayout->setContentsMargins(0, 0, 0, 0);
    editorLayout->setSpacing(0);

    findBar = new QWidget(editorPane);
    findBar->setVisible(false);
    auto *findLayout = new QHBoxLayout(findBar);
    findLayout->setContentsMargins(8, 6, 8, 6);
    findLayout->setSpacing(6);
    findEdit = new QLineEdit(findBar);
    findEdit->setPlaceholderText(QStringLiteral("Find in script"));
    findCountLabel = new QLabel(QStringLiteral("0 of 0"), findBar);
    caseSensitiveCheck = new QCheckBox(QStringLiteral("Case"), findBar);
    auto *previousButton = new QPushButton(QStringLiteral("Previous"), findBar);
    auto *nextButton = new QPushButton(QStringLiteral("Next"), findBar);
    auto *closeFindButton = new QPushButton(QStringLiteral("Close"), findBar);
    findLayout->addWidget(findEdit, 1);
    findLayout->addWidget(findCountLabel);
    findLayout->addWidget(caseSensitiveCheck);
    findLayout->addWidget(previousButton);
    findLayout->addWidget(nextButton);
    findLayout->addWidget(closeFindButton);
    editorLayout->addWidget(findBar);

    editor = new QPlainTextEdit(editorPane);
    editor->setLineWrapMode(QPlainTextEdit::WidgetWidth);
    editor->setTabStopDistance(32);
    editor->setPlaceholderText(QStringLiteral("Write Fountain here..."));
    updateEditorFont();
    highlighter = new FountainHighlighter(editor->document());
    editorLayout->addWidget(editor, 1);

    auto *rightPane = new QWidget(mainSplitter);
    auto *rightLayout = new QVBoxLayout(rightPane);
    rightLayout->setContentsMargins(12, 12, 12, 12);
    rightLayout->setSpacing(10);

    summaryLabel = new QLabel(rightPane);
    summaryLabel->setWordWrap(true);
    rightLayout->addWidget(summaryLabel);

    characterTable = new QTableWidget(0, 5, rightPane);
    characterTable->setHorizontalHeaderLabels({
        QStringLiteral("Character"),
        QStringLiteral("Lines"),
        QStringLiteral("Words"),
        QStringLiteral("Scenes"),
        QStringLiteral("Time")
    });
    characterTable->horizontalHeader()->setStretchLastSection(true);
    characterTable->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
    characterTable->verticalHeader()->hide();
    characterTable->setSelectionBehavior(QAbstractItemView::SelectRows);
    characterTable->setSelectionMode(QAbstractItemView::SingleSelection);
    rightLayout->addWidget(characterTable, 3);

    ollamaStatusLabel = new QLabel(rightPane);
    ollamaStatusLabel->setWordWrap(true);
    rightLayout->addWidget(ollamaStatusLabel);

    auto *ollamaRow = new QWidget(rightPane);
    auto *ollamaLayout = new QHBoxLayout(ollamaRow);
    ollamaLayout->setContentsMargins(0, 0, 0, 0);
    modelCombo = new QComboBox(ollamaRow);
    modelCombo->setToolTip(QStringLiteral("Recommended local Ollama models"));
    for (const QString &model : recommendedModels()) {
        modelCombo->addItem(model, model);
    }
    modelCombo->setCurrentIndex(qMax(0, modelCombo->findData(QStringLiteral("llama3.1"))));
    checkOllamaButton = new QPushButton(QStringLiteral("Check"), ollamaRow);
    installOllamaButton = new QPushButton(QStringLiteral("Install Ollama"), ollamaRow);
    installModelButton = new QPushButton(QStringLiteral("Install Model"), ollamaRow);
    synopsisButton = new QPushButton(QStringLiteral("Character Synopsis"), ollamaRow);
    scriptReportButton = new QPushButton(QStringLiteral("Script Report"), ollamaRow);
    ollamaLayout->addWidget(modelCombo, 1);
    ollamaLayout->addWidget(checkOllamaButton);
    ollamaLayout->addWidget(installOllamaButton);
    ollamaLayout->addWidget(installModelButton);
    ollamaLayout->addWidget(synopsisButton);
    ollamaLayout->addWidget(scriptReportButton);
    rightLayout->addWidget(ollamaRow);

    synopsisEdit = new QTextEdit(rightPane);
    synopsisEdit->setReadOnly(true);
    synopsisEdit->setPlaceholderText(QStringLiteral("Select a character for a character synopsis, or press Script Report for the whole script."));
    rightLayout->addWidget(synopsisEdit, 2);

    diagnosticsList = new QListWidget(rightPane);
    diagnosticsList->setToolTip(QStringLiteral("Double-click a correction to apply it."));
    rightLayout->addWidget(new QLabel(QStringLiteral("Corrections"), rightPane));
    rightLayout->addWidget(diagnosticsList, 2);

    auto *fixButton = new QPushButton(QStringLiteral("Apply Selected Fix"), rightPane);
    rightLayout->addWidget(fixButton);

    mainSplitter->addWidget(editorPane);
    mainSplitter->addWidget(rightPane);
    mainSplitter->setStretchFactor(0, 3);
    mainSplitter->setStretchFactor(1, 2);
    setCentralWidget(mainSplitter);

    auto *debounce = new QTimer(this);
    debounce->setInterval(220);
    debounce->setSingleShot(true);
    connect(editor, &QPlainTextEdit::textChanged, debounce, qOverload<>(&QTimer::start));
    connect(editor, &QPlainTextEdit::textChanged, this, &MainWindow::updateFindMatches);
    connect(debounce, &QTimer::timeout, this, &MainWindow::analyze);
    connect(findEdit, &QLineEdit::textChanged, this, &MainWindow::updateFindMatches);
    connect(findEdit, &QLineEdit::returnPressed, this, &MainWindow::findNext);
    connect(caseSensitiveCheck, &QCheckBox::toggled, this, &MainWindow::updateFindMatches);
    connect(previousButton, &QPushButton::clicked, this, &MainWindow::findPrevious);
    connect(nextButton, &QPushButton::clicked, this, &MainWindow::findNext);
    connect(closeFindButton, &QPushButton::clicked, this, &MainWindow::hideFindBar);
    connect(fixButton, &QPushButton::clicked, this, &MainWindow::applySelectedFix);
    connect(diagnosticsList, &QListWidget::itemDoubleClicked, this, &MainWindow::applySelectedFix);
    connect(checkOllamaButton, &QPushButton::clicked, this, &MainWindow::checkOllama);
    connect(installOllamaButton, &QPushButton::clicked, this, &MainWindow::installOllama);
    connect(installModelButton, &QPushButton::clicked, this, &MainWindow::installRecommendedModel);
    connect(synopsisButton, &QPushButton::clicked, this, &MainWindow::generateSynopsis);
    connect(scriptReportButton, &QPushButton::clicked, this, &MainWindow::generateScriptReport);
    connect(modelCombo, qOverload<int>(&QComboBox::activated), this, &MainWindow::handleModelSelection);
    connect(modelCombo, qOverload<int>(&QComboBox::currentIndexChanged), this, [this] {
        saveSettings();
        checkOllama();
    });
    connect(&ollamaInstallProcess, &QProcess::finished, this, &MainWindow::handleOllamaInstallFinished);
    connect(&modelInstallProcess, &QProcess::finished, this, &MainWindow::handleModelInstallFinished);
    connect(&ollamaInstallProcess, &QProcess::errorOccurred, this, [this](QProcess::ProcessError) {
        installOllamaButton->setEnabled(true);
        synopsisEdit->setPlainText(QStringLiteral("Ollama install could not be started."));
        checkOllama();
    });
    connect(&modelInstallProcess, &QProcess::errorOccurred, this, [this](QProcess::ProcessError) {
        installModelButton->setEnabled(true);
        synopsisEdit->setPlainText(QStringLiteral("Model install could not be started."));
        checkOllama();
    });

    updateOllamaControls(false, false, QStringLiteral("Checking Ollama setup..."));
    QTimer::singleShot(250, this, &MainWindow::checkOllama);
}

void MainWindow::newDocument()
{
    if (!maybeSave()) {
        return;
    }
    currentPath.clear();
    editor->clear();
    editor->document()->setModified(false);
    updateWindowTitle();
    analyze();
}

void MainWindow::openDocument()
{
    if (!maybeSave()) {
        return;
    }

    const QString path = QFileDialog::getOpenFileName(
        this,
        QStringLiteral("Open Fountain File"),
        QString(),
        QStringLiteral("Fountain files (*.fountain *.txt);;All files (*.*)"));
    if (path.isEmpty()) {
        return;
    }

    loadDocumentFromPath(path);
}

void MainWindow::saveDocument()
{
    if (currentPath.isEmpty()) {
        saveDocumentAs();
        return;
    }
    saveToPath(currentPath);
}

void MainWindow::saveDocumentAs()
{
    const QString path = QFileDialog::getSaveFileName(
        this,
        QStringLiteral("Save Fountain File"),
        currentPath.isEmpty() ? QStringLiteral("Untitled.fountain") : currentPath,
        QStringLiteral("Fountain files (*.fountain);;Text files (*.txt);;All files (*.*)"));
    if (path.isEmpty()) {
        return;
    }
    saveToPath(path);
}

void MainWindow::exportPdf()
{
    const QString baseName = currentPath.isEmpty()
                                 ? QStringLiteral("Untitled.pdf")
                                 : QFileInfo(currentPath).completeBaseName() + QStringLiteral(".pdf");
    const QString path = QFileDialog::getSaveFileName(
        this,
        QStringLiteral("Export PDF"),
        baseName,
        QStringLiteral("PDF files (*.pdf)"));
    if (path.isEmpty()) {
        return;
    }
    writeScreenplayPdf(path);
}

void MainWindow::exportPdfWithSynopsis()
{
    const QString baseName = currentPath.isEmpty()
                                 ? QStringLiteral("Untitled.pdf")
                                 : QFileInfo(currentPath).completeBaseName() + QStringLiteral(".pdf");
    const QString path = QFileDialog::getSaveFileName(
        this,
        QStringLiteral("Export Screenplay and Analytics PDFs"),
        baseName,
        QStringLiteral("PDF files (*.pdf)"));
    if (path.isEmpty()) {
        return;
    }

    QString screenplayPath = path;
    if (!screenplayPath.endsWith(QStringLiteral(".pdf"), Qt::CaseInsensitive)) {
        screenplayPath += QStringLiteral(".pdf");
    }

    const QFileInfo screenplayInfo(screenplayPath);
    const QString analyticsPath = screenplayInfo.dir().filePath(screenplayInfo.completeBaseName() + QStringLiteral("-analytics.pdf"));

    const bool screenplayExported = writeScreenplayPdf(screenplayPath);
    const bool analyticsExported = screenplayExported && writeAnalyticsPdf(analyticsPath);
    if (screenplayExported && analyticsExported) {
        statusBar()->showMessage(QStringLiteral("Exported screenplay PDF %1 and analytics PDF %2").arg(screenplayPath, analyticsPath), 5000);
    }
}

void MainWindow::fillSample()
{
    editor->setPlainText(QStringLiteral(
        "Title: The Glass Harbor\n"
        "Credit: Written by\n"
        "Author: Devon Example\n"
        "\n"
        "# Act One\n"
        "INT. FERRY TERMINAL - NIGHT\n"
        "\n"
        "Rain needles the windows. A late ferry groans against the dock.\n"
        "\n"
        "MARA\n"
        "I thought the last boat left at ten.\n"
        "\n"
        "JONAH\n"
        "(checking his watch)\n"
        "It did. That's what worries me.\n"
        "\n"
        "CUT TO:\n"
        "\n"
        "EXT. HARBOR WALK - LATER\n"
        "\n"
        "Mara spots a suitcase sitting under a dead payphone.\n"
        "\n"
        "MARA\n"
        "Jonah, don't touch it.\n"));
    editor->document()->setModified(false);
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    if (maybeSave()) {
        saveSettings();
        event->accept();
    } else {
        event->ignore();
    }
}

void MainWindow::loadSettings()
{
    loadingSettings = true;
    QSettings settings(userPreferencesPath(), QSettings::IniFormat);
    editorPointSize = settings.value(QStringLiteral("editor/pointSize"), editorPointSize).toInt();
    editorPointSize = qBound(10, editorPointSize, 28);
    const QString savedModel = settings.value(QStringLiteral("ollama/model"), recommendedModel()).toString();
    if (modelCombo->findData(savedModel) < 0) {
        modelCombo->addItem(savedModel, savedModel);
    }
    modelCombo->setCurrentIndex(qMax(0, modelCombo->findData(savedModel)));
    updateEditorFont();

    currentTheme = themeFromSettingsValue(settings.value(QStringLiteral("view/theme"), 0).toInt());
    applyTheme(currentTheme);

    const QByteArray geometry = settings.value(QStringLiteral("window/geometry")).toByteArray();
    if (!geometry.isEmpty()) {
        restoreGeometry(geometry);
    }

    const QByteArray splitterState = settings.value(QStringLiteral("window/splitter")).toByteArray();
    if (!splitterState.isEmpty()) {
        mainSplitter->restoreState(splitterState);
    }

    const QString lastPath = settings.value(QStringLiteral("files/lastPath")).toString();
    if (!lastPath.isEmpty() && QFileInfo::exists(lastPath) && loadDocumentFromPath(lastPath)) {
        loadingSettings = false;
        saveSettings();
        return;
    }

    fillSample();
    updateWindowTitle();
    loadingSettings = false;
}

void MainWindow::saveSettings()
{
    QSettings settings(userPreferencesPath(), QSettings::IniFormat);
    settings.setValue(QStringLiteral("editor/pointSize"), editorPointSize);
    settings.setValue(QStringLiteral("view/theme"), themeToSettingsValue(currentTheme));
    settings.setValue(QStringLiteral("ollama/model"), recommendedModel());
    settings.setValue(QStringLiteral("window/geometry"), saveGeometry());
    settings.setValue(QStringLiteral("window/splitter"), mainSplitter->saveState());
    settings.setValue(QStringLiteral("files/lastPath"), currentPath);
    settings.sync();
}

bool MainWindow::loadDocumentFromPath(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
        QMessageBox::warning(this, QStringLiteral("Open Failed"), file.errorString());
        return false;
    }

    currentPath = path;
    editor->setPlainText(QString::fromUtf8(file.readAll()));
    editor->document()->setModified(false);
    updateWindowTitle();
    analyze();
    if (!loadingSettings) {
        saveSettings();
    }
    return true;
}

void MainWindow::updateWindowTitle()
{
    if (currentPath.isEmpty()) {
        setWindowTitle(QStringLiteral("Screenwriter"));
        return;
    }
    setWindowTitle(QStringLiteral("%1 - Screenwriter").arg(QFileInfo(currentPath).fileName()));
}

int MainWindow::themeToSettingsValue(VisualTheme theme) const
{
    return static_cast<int>(theme);
}

VisualTheme MainWindow::themeFromSettingsValue(int value) const
{
    switch (value) {
    case 1:
        return VisualTheme::Warm;
    case 2:
        return VisualTheme::HighContrastLight;
    case 3:
        return VisualTheme::HighContrastDark;
    case 4:
        return VisualTheme::OneDarkDarker;
    case 0:
    default:
        return VisualTheme::Standard;
    }
}

void MainWindow::analyze()
{
    currentDocument = parser.parse(editor->toPlainText());
    updateCharacterTable();
    updateDiagnostics();
    updateSceneMenu();
    summaryLabel->setText(QStringLiteral("%1 scenes | %2 characters | %3 words | est. %4 | %5 corrections")
                              .arg(currentDocument.sceneCount)
                              .arg(currentDocument.characters.size())
                              .arg(currentDocument.wordCount)
                              .arg(estimatedRuntimeText())
                              .arg(currentDocument.diagnostics.size()));
}

void MainWindow::checkOllama()
{
    const bool installed = !ollamaExecutable().isEmpty();
    if (!installed) {
        installedOllamaModels.clear();
        refreshModelDropdown();
        updateOllamaControls(false, false, QStringLiteral("Ollama was not found. Install it to enable local character synopses."));
        return;
    }

    updateOllamaControls(true, false, QStringLiteral("Ollama is installed. Checking for model %1...").arg(recommendedModel()));

    QNetworkRequest request(QUrl(QStringLiteral("http://localhost:11434/api/tags")));
    QNetworkReply *reply = network.get(request);
    connect(reply, &QNetworkReply::finished, this, &MainWindow::handleModelListReply);
}

void MainWindow::installOllama()
{
    if (!ollamaExecutable().isEmpty()) {
        checkOllama();
        return;
    }

#ifdef Q_OS_MACOS
    const QString brew = QStandardPaths::findExecutable(QStringLiteral("brew"), {
        QStringLiteral("/opt/homebrew/bin"),
        QStringLiteral("/usr/local/bin")
    });
    if (!brew.isEmpty()) {
        installOllamaButton->setEnabled(false);
        synopsisEdit->setPlainText(QStringLiteral("Installing Ollama with Homebrew..."));
        ollamaInstallProcess.start(brew, {QStringLiteral("install"), QStringLiteral("ollama")});
        return;
    }
#endif

    QDesktopServices::openUrl(QUrl(QStringLiteral("https://ollama.com/download")));
    synopsisEdit->setPlainText(QStringLiteral("The Ollama download page was opened. Install Ollama, start it, then press Check."));
}

void MainWindow::installRecommendedModel()
{
    if (ollamaExecutable().isEmpty()) {
        updateOllamaControls(false, false, QStringLiteral("Install Ollama before installing the recommended model."));
        return;
    }

    const QString model = recommendedModel();
    if (modelInstalled(model)) {
        checkOllama();
        return;
    }

    const auto choice = QMessageBox::question(
        this,
        QStringLiteral("Install %1?").arg(model),
        QStringLiteral("%1\n\nDownload and install this model with Ollama?").arg(modelHardwareNote(model)),
        QMessageBox::Yes | QMessageBox::No,
        QMessageBox::No);
    if (choice != QMessageBox::Yes) {
        return;
    }

    installModelButton->setEnabled(false);
    synopsisEdit->setPlainText(QStringLiteral("Installing %1 with Ollama. This can take a while.").arg(model));
    startOllamaProcess(&modelInstallProcess, {QStringLiteral("pull"), model});
}

void MainWindow::handleOllamaInstallFinished(int exitCode, QProcess::ExitStatus status)
{
    const QString output = QString::fromUtf8(ollamaInstallProcess.readAllStandardOutput())
                               + QString::fromUtf8(ollamaInstallProcess.readAllStandardError());
    installOllamaButton->setEnabled(true);
    if (status == QProcess::NormalExit && exitCode == 0) {
        synopsisEdit->setPlainText(QStringLiteral("Ollama installed. Start Ollama if it is not already running, then install the recommended model."));
    } else {
        synopsisEdit->setPlainText(QStringLiteral("Ollama install did not complete.\n\n%1").arg(output.trimmed()));
    }
    checkOllama();
}

void MainWindow::handleModelInstallFinished(int exitCode, QProcess::ExitStatus status)
{
    const QString output = QString::fromUtf8(modelInstallProcess.readAllStandardOutput())
                               + QString::fromUtf8(modelInstallProcess.readAllStandardError());
    installModelButton->setEnabled(true);
    if (status == QProcess::NormalExit && exitCode == 0) {
        synopsisEdit->setPlainText(QStringLiteral("%1 is installed and ready.").arg(recommendedModel()));
    } else {
        synopsisEdit->setPlainText(QStringLiteral("Model install did not complete.\n\n%1").arg(output.trimmed()));
    }
    checkOllama();
}

void MainWindow::handleModelListReply()
{
    auto *reply = qobject_cast<QNetworkReply *>(sender());
    if (!reply) {
        return;
    }

    const QByteArray body = reply->readAll();
    if (reply->error() != QNetworkReply::NoError) {
        reply->deleteLater();
        updateOllamaControls(true, false, QStringLiteral("Ollama is installed, but the local server is not responding. Start Ollama, then press Check."));
        return;
    }

    bool found = false;
    const QString wanted = recommendedModel();
    installedOllamaModels.clear();
    const QJsonArray models = QJsonDocument::fromJson(body).object().value(QStringLiteral("models")).toArray();
    for (const QJsonValue &value : models) {
        const QString name = value.toObject().value(QStringLiteral("name")).toString();
        const QString model = value.toObject().value(QStringLiteral("model")).toString();
        if (!name.isEmpty()) {
            installedOllamaModels.insert(name);
        }
        if (!model.isEmpty()) {
            installedOllamaModels.insert(model);
        }
        if (name.startsWith(wanted) || model.startsWith(wanted)) {
            found = true;
        }
    }

    refreshModelDropdown();
    updateOllamaControls(true, found,
                         found ? QStringLiteral("Ollama is ready with %1.").arg(wanted)
                               : QStringLiteral("Ollama is running, but %1 is not installed.").arg(wanted));
    reply->deleteLater();
}

void MainWindow::updateCharacterTable()
{
    characterTable->setRowCount(currentDocument.characters.size());
    for (int row = 0; row < currentDocument.characters.size(); ++row) {
        const CharacterStats &stats = currentDocument.characters.at(row);
        characterTable->setItem(row, 0, item(stats.name));
        characterTable->setItem(row, 1, item(QString::number(stats.dialogueLines)));
        characterTable->setItem(row, 2, item(QString::number(stats.dialogueWords)));
        characterTable->setItem(row, 3, item(QString::number(stats.sceneCount)));
        characterTable->setItem(row, 4, item(durationText(stats.estimatedSeconds)));
    }
    if (characterTable->rowCount() > 0 && !characterTable->currentItem()) {
        characterTable->selectRow(0);
    }
}

void MainWindow::updateDiagnostics()
{
    diagnosticsList->clear();
    for (int i = 0; i < currentDocument.diagnostics.size(); ++i) {
        const FountainDiagnostic &diagnostic = currentDocument.diagnostics.at(i);
        auto *listItem = new QListWidgetItem(
            QStringLiteral("Line %1: %2").arg(diagnostic.line + 1).arg(diagnostic.message),
            diagnosticsList);
        listItem->setData(Qt::UserRole, i);
    }
}

void MainWindow::updateSceneMenu()
{
    scenesMenu->clear();
    int sceneNumber = 0;
    for (const FountainLine &line : currentDocument.lines) {
        if (line.type != FountainLineType::SceneHeading) {
            continue;
        }

        ++sceneNumber;
        QString label = line.text.trimmed();
        if (label.size() > 80) {
            label = label.left(77) + QStringLiteral("...");
        }
        auto *sceneAction = scenesMenu->addAction(QStringLiteral("%1. %2").arg(sceneNumber).arg(label));
        sceneAction->setData(line.start);
        connect(sceneAction, &QAction::triggered, this, &MainWindow::jumpToScene);
    }

    if (sceneNumber == 0) {
        auto *emptyAction = scenesMenu->addAction(QStringLiteral("No scenes found"));
        emptyAction->setEnabled(false);
    }

    const bool hasScenes = sceneNumber > 0;
    scenesMenu->setEnabled(hasScenes);
    nextSceneAction->setEnabled(hasScenes);
    previousSceneAction->setEnabled(hasScenes);
}

void MainWindow::jumpToScene()
{
    auto *action = qobject_cast<QAction *>(sender());
    if (!action) {
        return;
    }
    jumpToPosition(action->data().toInt());
}

void MainWindow::jumpToNextScene()
{
    if (currentDocument.sceneCount == 0) {
        return;
    }

    const int currentPosition = editor->textCursor().position();
    for (const FountainLine &line : currentDocument.lines) {
        if (line.type == FountainLineType::SceneHeading && line.start > currentPosition) {
            jumpToPosition(line.start);
            return;
        }
    }

    for (const FountainLine &line : currentDocument.lines) {
        if (line.type == FountainLineType::SceneHeading) {
            jumpToPosition(line.start);
            statusBar()->showMessage(QStringLiteral("Wrapped to first scene."), 1600);
            return;
        }
    }
}

void MainWindow::jumpToPreviousScene()
{
    if (currentDocument.sceneCount == 0) {
        return;
    }

    const int currentPosition = editor->textCursor().position();
    int previousPosition = -1;
    int lastPosition = -1;
    for (const FountainLine &line : currentDocument.lines) {
        if (line.type != FountainLineType::SceneHeading) {
            continue;
        }
        lastPosition = line.start;
        if (line.start < currentPosition) {
            previousPosition = line.start;
        }
    }

    if (previousPosition >= 0) {
        jumpToPosition(previousPosition);
        return;
    }

    if (lastPosition >= 0) {
        jumpToPosition(lastPosition);
        statusBar()->showMessage(QStringLiteral("Wrapped to last scene."), 1600);
    }
}

void MainWindow::jumpToPosition(int position)
{
    QTextCursor cursor(editor->document());
    cursor.setPosition(qBound(0, position, editor->document()->characterCount() - 1));
    cursor.movePosition(QTextCursor::EndOfLine, QTextCursor::KeepAnchor);
    editor->setTextCursor(cursor);
    editor->centerCursor();
    editor->setFocus();
}

void MainWindow::updateEditorFont()
{
    if (!editor) {
        return;
    }

    QFont mono = QFontDatabase::systemFont(QFontDatabase::FixedFont);
    mono.setPointSize(editorPointSize);
    editor->setFont(mono);
    editor->setTabStopDistance(QFontMetricsF(mono).horizontalAdvance(' ') * 4);
}

void MainWindow::updateOllamaControls(bool installed, bool modelPresent, const QString &message)
{
    ollamaModelReady = installed && modelPresent;
    ollamaStatusLabel->setText(message);
    installOllamaButton->setVisible(!installed);
    installModelButton->setVisible(installed && !modelPresent);
    synopsisButton->setEnabled(ollamaModelReady);
    scriptReportButton->setEnabled(ollamaModelReady);
}

void MainWindow::handleModelSelection(int index)
{
    const QString model = modelCombo->itemData(index).toString();
    if (model.isEmpty()) {
        return;
    }

    saveSettings();
    if (modelInstalled(model)) {
        checkOllama();
        return;
    }

    installRecommendedModel();
}

void MainWindow::refreshModelDropdown()
{
    if (!modelCombo) {
        return;
    }

    auto *itemModel = qobject_cast<QStandardItemModel *>(modelCombo->model());
    if (!itemModel) {
        return;
    }

    for (int row = 0; row < modelCombo->count(); ++row) {
        const QString model = modelCombo->itemData(row).toString();
        const bool installed = modelInstalled(model);
        const QString label = installed ? model : QStringLiteral("%1 (not installed)").arg(model);
        modelCombo->setItemText(row, label);

        QStandardItem *item = itemModel->item(row);
        if (!item) {
            continue;
        }
        item->setForeground(installed ? QBrush(qApp->palette().color(QPalette::Text))
                                      : QBrush(QColor("#8a8f98")));
        item->setToolTip(modelHardwareNote(model));
    }
}

bool MainWindow::modelInstalled(const QString &model) const
{
    for (const QString &installed : installedOllamaModels) {
        if (installed == model || installed.startsWith(model + QLatin1Char(':'))) {
            return true;
        }
    }
    return false;
}

QStringList MainWindow::recommendedModels() const
{
    QStringList models;
    const QJsonArray specs = modelSpecs();
    for (const QJsonValue &value : specs) {
        const QString name = value.toObject().value(QStringLiteral("name")).toString();
        if (!name.isEmpty()) {
            models << name;
        }
    }

    if (!models.isEmpty()) {
        return models;
    }

    return {QStringLiteral("llama3.1")};
}

QString MainWindow::modelHardwareNote(const QString &model) const
{
    const QJsonObject spec = modelSpec(model);
    if (spec.isEmpty()) {
        return QStringLiteral("%1\n\nCompatibility: Unknown. This model is not in the packaged recommendation database. Check the model size and memory requirements before installing.")
            .arg(model);
    }

    const double memoryGb = totalMemoryGb();
    QStringList lines;
    lines << QStringLiteral("Model: %1").arg(model);
    lines << QStringLiteral("Download size: about %1 GB")
                 .arg(QString::number(spec.value(QStringLiteral("downloadSizeGb")).toDouble(), 'f', 1));
    lines << QStringLiteral("Minimum RAM: %1 GB").arg(spec.value(QStringLiteral("minimumRamGb")).toInt());
    lines << QStringLiteral("Recommended RAM: %1 GB").arg(spec.value(QStringLiteral("recommendedRamGb")).toInt());

    const int gpuVram = spec.value(QStringLiteral("recommendedGpuVramGb")).toInt();
    if (gpuVram > 0) {
        lines << QStringLiteral("Recommended GPU VRAM: %1 GB, if using GPU acceleration").arg(gpuVram);
    } else {
        lines << QStringLiteral("Recommended GPU VRAM: none required");
    }

    lines << QString();
    lines << machineSummary(memoryGb);
    lines << QString();
    lines << modelCompatibilityText(spec, memoryGb);
    lines << spec.value(QStringLiteral("quality")).toString();
    lines << spec.value(QStringLiteral("performance")).toString();
    return lines.join(QStringLiteral("\n"));
}

void MainWindow::showFindBar()
{
    findBar->setVisible(true);
    const QString selected = editor->textCursor().selectedText();
    if (!selected.isEmpty() && !selected.contains(QChar::ParagraphSeparator)) {
        findEdit->setText(selected);
        findEdit->selectAll();
    }
    findEdit->setFocus();
    updateFindMatches();
}

void MainWindow::hideFindBar()
{
    findBar->setVisible(false);
    editor->setFocus();
}

void MainWindow::findNext()
{
    if (!findBar->isVisible()) {
        showFindBar();
        return;
    }
    findText({});
}

void MainWindow::findPrevious()
{
    if (!findBar->isVisible()) {
        showFindBar();
        return;
    }
    findText(QTextDocument::FindBackward);
}

bool MainWindow::findText(QTextDocument::FindFlags flags)
{
    const QString needle = findEdit->text();
    if (needle.isEmpty()) {
        updateFindMatches();
        return false;
    }

    if (caseSensitiveCheck->isChecked()) {
        flags |= QTextDocument::FindCaseSensitively;
    }

    if (editor->find(needle, flags)) {
        updateFindMatches();
        return true;
    }

    QTextCursor cursor = editor->textCursor();
    cursor.clearSelection();
    cursor.setPosition(flags.testFlag(QTextDocument::FindBackward)
                           ? editor->document()->characterCount() - 1
                           : 0);
    editor->setTextCursor(cursor);

    const bool found = editor->find(needle, flags);
    updateFindMatches();
    if (found) {
        statusBar()->showMessage(QStringLiteral("Search wrapped."), 1600);
    }
    return found;
}

void MainWindow::updateFindMatches()
{
    if (!findCountLabel || !findEdit) {
        return;
    }

    const QString needle = findEdit->text();
    if (needle.isEmpty()) {
        findCountLabel->setText(QStringLiteral("0 of 0"));
        findEdit->setStyleSheet({});
        return;
    }

    QTextDocument::FindFlags flags;
    if (caseSensitiveCheck->isChecked()) {
        flags |= QTextDocument::FindCaseSensitively;
    }

    int total = 0;
    int current = 0;
    const QTextCursor activeCursor = editor->textCursor();
    const int activeStart = activeCursor.hasSelection()
                                ? qMin(activeCursor.selectionStart(), activeCursor.selectionEnd())
                                : activeCursor.position();

    QTextCursor cursor(editor->document());
    cursor.setPosition(0);
    while (true) {
        cursor = editor->document()->find(needle, cursor, flags);
        if (cursor.isNull()) {
            break;
        }
        ++total;
        if (cursor.selectionStart() <= activeStart && activeStart <= cursor.selectionEnd()) {
            current = total;
        }
    }

    if (total == 0) {
        findCountLabel->setText(QStringLiteral("0 of 0"));
        findEdit->setStyleSheet(QStringLiteral("QLineEdit { background: #ffd9d9; color: #3b0a0a; }"));
        return;
    }

    if (current == 0) {
        current = 1;
    }
    findCountLabel->setText(QStringLiteral("%1 of %2").arg(current).arg(total));
    findEdit->setStyleSheet({});
}

QString MainWindow::ollamaExecutable() const
{
#ifdef Q_OS_WIN
    const QString executableName = QStringLiteral("ollama.exe");
#else
    const QString executableName = QStringLiteral("ollama");
#endif

    const QString fromPath = QStandardPaths::findExecutable(executableName);
    if (!fromPath.isEmpty()) {
        return fromPath;
    }

    QStringList searchPaths;
#ifdef Q_OS_WIN
    const QString localAppData = qEnvironmentVariable("LOCALAPPDATA");
    const QString programFiles = qEnvironmentVariable("ProgramFiles");
    const QString programFilesX86 = qEnvironmentVariable("ProgramFiles(x86)");
    if (!localAppData.isEmpty()) {
        searchPaths << QDir(localAppData).filePath(QStringLiteral("Programs/Ollama"));
    }
    if (!programFiles.isEmpty()) {
        searchPaths << QDir(programFiles).filePath(QStringLiteral("Ollama"));
        searchPaths << QDir(programFiles).filePath(QStringLiteral("Ollama Inc/Ollama"));
    }
    if (!programFilesX86.isEmpty()) {
        searchPaths << QDir(programFilesX86).filePath(QStringLiteral("Ollama"));
        searchPaths << QDir(programFilesX86).filePath(QStringLiteral("Ollama Inc/Ollama"));
    }
#elif defined(Q_OS_MACOS)
    searchPaths << QStringLiteral("/opt/homebrew/bin")
                << QStringLiteral("/usr/local/bin")
                << QStringLiteral("/usr/bin")
                << QStringLiteral("/Applications/Ollama.app/Contents/Resources")
                << QDir::home().filePath(QStringLiteral("Applications/Ollama.app/Contents/Resources"));
#else
    searchPaths << QStringLiteral("/usr/local/bin")
                << QStringLiteral("/usr/bin")
                << QStringLiteral("/bin")
                << QStringLiteral("/snap/bin")
                << QDir::home().filePath(QStringLiteral(".local/bin"));
#endif

    const QString fromKnownLocation = QStandardPaths::findExecutable(executableName, searchPaths);
    if (!fromKnownLocation.isEmpty()) {
        return fromKnownLocation;
    }

    for (const QString &searchPath : searchPaths) {
        const QString candidate = QDir(searchPath).filePath(executableName);
        const QFileInfo info(candidate);
        if (info.isFile() && info.isExecutable()) {
            return info.absoluteFilePath();
        }
    }

    return {};
}

QString MainWindow::recommendedModel() const
{
    const QString model = modelCombo ? modelCombo->currentData().toString().trimmed() : QString();
    return model.isEmpty() ? QStringLiteral("llama3.1") : model;
}

bool MainWindow::startOllamaProcess(QProcess *process, const QStringList &arguments)
{
    const QString executable = ollamaExecutable();
    if (executable.isEmpty()) {
        return false;
    }
    process->start(executable, arguments);
    return true;
}

void MainWindow::increaseTextSize()
{
    editorPointSize = qMin(28, editorPointSize + 1);
    updateEditorFont();
    if (!loadingSettings) {
        saveSettings();
    }
}

void MainWindow::decreaseTextSize()
{
    editorPointSize = qMax(10, editorPointSize - 1);
    updateEditorFont();
    if (!loadingSettings) {
        saveSettings();
    }
}

void MainWindow::resetTextSize()
{
    editorPointSize = 15;
    updateEditorFont();
    if (!loadingSettings) {
        saveSettings();
    }
}

void MainWindow::applyTheme(VisualTheme theme)
{
    currentTheme = theme;
    FountainColorTheme highlighterTheme = FountainColorTheme::Standard;
    QString style;

    switch (theme) {
    case VisualTheme::Warm:
        highlighterTheme = FountainColorTheme::Warm;
        style = QStringLiteral(
            "QMainWindow, QWidget { background: #f6efe4; color: #26231f; }"
            "QPlainTextEdit, QTextEdit { background: #fffaf0; color: #26231f; selection-background-color: #2f6f73; selection-color: #ffffff; }"
            "QTableWidget, QListWidget, QLineEdit { background: #fffaf0; color: #26231f; border: 1px solid #b9aa98; }"
            "QHeaderView::section { background: #eadcc9; color: #26231f; padding: 4px; border: 1px solid #b9aa98; }"
            "QPushButton { background: #e6d4bd; color: #26231f; border: 1px solid #9f8d78; padding: 6px 10px; }"
            "QPushButton:disabled { color: #8a8178; }"
            "QMenuBar, QMenu { background: #f6efe4; color: #26231f; }");
        break;
    case VisualTheme::HighContrastLight:
        highlighterTheme = FountainColorTheme::HighContrastLight;
        style = QStringLiteral(
            "QMainWindow, QWidget { background: #ffffff; color: #000000; }"
            "QPlainTextEdit, QTextEdit { background: #ffffff; color: #000000; selection-background-color: #000000; selection-color: #ffffff; }"
            "QTableWidget, QListWidget, QLineEdit { background: #ffffff; color: #000000; border: 2px solid #000000; }"
            "QHeaderView::section { background: #e6e6e6; color: #000000; padding: 4px; border: 2px solid #000000; }"
            "QPushButton { background: #ffffff; color: #000000; border: 2px solid #000000; padding: 6px 10px; }"
            "QPushButton:disabled { color: #5f5f5f; }"
            "QMenuBar, QMenu { background: #ffffff; color: #000000; }");
        break;
    case VisualTheme::HighContrastDark:
        highlighterTheme = FountainColorTheme::HighContrastDark;
        style = QStringLiteral(
            "QMainWindow, QWidget { background: #000000; color: #ffffff; }"
            "QPlainTextEdit, QTextEdit { background: #000000; color: #ffffff; selection-background-color: #ffffff; selection-color: #000000; }"
            "QTableWidget, QListWidget, QLineEdit { background: #000000; color: #ffffff; border: 2px solid #ffffff; }"
            "QHeaderView::section { background: #1a1a1a; color: #ffffff; padding: 4px; border: 2px solid #ffffff; }"
            "QPushButton { background: #000000; color: #ffffff; border: 2px solid #ffffff; padding: 6px 10px; }"
            "QPushButton:disabled { color: #9a9a9a; }"
            "QMenuBar, QMenu { background: #000000; color: #ffffff; }");
        break;
    case VisualTheme::OneDarkDarker:
        highlighterTheme = FountainColorTheme::OneDarkDarker;
        style = QStringLiteral(
            "QMainWindow, QWidget { background: #181A1F; color: #d7dae0; }"
            "QPlainTextEdit, QTextEdit { background: #181A1F; color: #abb2bf; selection-background-color: #42557b; selection-color: #f8fafd; }"
            "QPlainTextEdit { border: 1px solid #181a1f; }"
            "QTableWidget, QListWidget, QLineEdit { background: #1d1f23; color: #d7dae0; border: 1px solid #2c313a; selection-background-color: #2c313a; selection-color: #d7dae0; }"
            "QHeaderView::section { background: #2c313a; color: #d7dae0; padding: 4px; border: 1px solid #181a1f; }"
            "QPushButton { background: #404754; color: #f8fafd; border: 1px solid #515a6b; padding: 6px 10px; }"
            "QPushButton:hover { background: #4e5666; }"
            "QPushButton:disabled { color: #737984; background: #2c313a; }"
            "QMenuBar, QMenu { background: #181A1F; color: #c8c8c8; }"
            "QMenu::item:selected { background: #2c313a; color: #d7dae0; }"
            "QStatusBar { background: #181A1F; color: #9da5b4; }");
        break;
    case VisualTheme::Standard:
        highlighterTheme = FountainColorTheme::Standard;
        style.clear();
        break;
    }

    qApp->setStyleSheet(style);
    if (highlighter) {
        highlighter->setColorTheme(highlighterTheme);
    }

    switch (theme) {
    case VisualTheme::Warm:
        warmThemeAction->setChecked(true);
        break;
    case VisualTheme::HighContrastLight:
        contrastLightAction->setChecked(true);
        break;
    case VisualTheme::HighContrastDark:
        contrastDarkAction->setChecked(true);
        break;
    case VisualTheme::OneDarkDarker:
        oneDarkDarkerAction->setChecked(true);
        break;
    case VisualTheme::Standard:
        standardThemeAction->setChecked(true);
        break;
    }
    if (!loadingSettings) {
        saveSettings();
    }
}

bool MainWindow::saveToPath(const QString &path)
{
    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text)) {
        QMessageBox::warning(this, QStringLiteral("Save Failed"), file.errorString());
        return false;
    }

    file.write(editor->toPlainText().toUtf8());
    if (!file.commit()) {
        QMessageBox::warning(this, QStringLiteral("Save Failed"), file.errorString());
        return false;
    }

    currentPath = path;
    editor->document()->setModified(false);
    updateWindowTitle();
    saveSettings();
    statusBar()->showMessage(QStringLiteral("Saved %1").arg(path), 2500);
    return true;
}

bool MainWindow::writeScreenplayPdf(const QString &path)
{
    analyze();

    QString outputPath = path;
    if (!outputPath.endsWith(QStringLiteral(".pdf"), Qt::CaseInsensitive)) {
        outputPath += QStringLiteral(".pdf");
    }

    QPrinter printer(QPrinter::HighResolution);
    printer.setOutputFormat(QPrinter::PdfFormat);
    printer.setOutputFileName(outputPath);
    printer.setPageSize(QPageSize(QPageSize::Letter));
    printer.setPageMargins(QMarginsF(0.65, 0.65, 0.65, 0.65), QPageLayout::Inch);
    printer.setResolution(300);

    QTextDocument document;
    document.setDefaultFont(QFont(QStringLiteral("Courier"), 12));
    document.setHtml(formattedScriptPdfHtml());
    document.print(&printer);

    statusBar()->showMessage(QStringLiteral("Exported PDF %1").arg(outputPath), 3500);
    return true;
}

bool MainWindow::writeAnalyticsPdf(const QString &path)
{
    analyze();

    QString outputPath = path;
    if (!outputPath.endsWith(QStringLiteral(".pdf"), Qt::CaseInsensitive)) {
        outputPath += QStringLiteral(".pdf");
    }

    QPrinter printer(QPrinter::HighResolution);
    printer.setOutputFormat(QPrinter::PdfFormat);
    printer.setOutputFileName(outputPath);
    printer.setPageSize(QPageSize(QPageSize::Letter));
    printer.setPageMargins(QMarginsF(0.55, 0.55, 0.55, 0.55), QPageLayout::Inch);
    printer.setResolution(300);

    QTextDocument document;
    document.setDefaultFont(QFont(QStringLiteral("Helvetica"), 10));
    document.setHtml(analyticsPdfHtml());
    document.print(&printer);

    return true;
}

QString MainWindow::formattedScriptPdfHtml() const
{
    QString html = QStringLiteral(
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        "<style>"
        "body { font-family: Courier, monospace; font-size: 12pt; color: #000; }"
        "p { margin: 0 0 10pt 0; line-height: 1.15; }"
        ".title { margin-left: 1.2in; margin-bottom: 7pt; }"
        ".title .key { font-weight: bold; }"
        ".scene { font-weight: bold; text-transform: uppercase; margin-top: 14pt; }"
        ".action { margin-right: .15in; }"
        ".character { margin-left: 2.45in; margin-top: 12pt; margin-bottom: 0; text-transform: uppercase; }"
        ".parenthetical { margin-left: 1.85in; margin-bottom: 0; width: 2.2in; }"
        ".dialogue { margin-left: 1.35in; width: 3.7in; margin-bottom: 0; }"
        ".transition { text-align: right; font-weight: bold; text-transform: uppercase; }"
        ".section { font-weight: bold; margin-top: 14pt; }"
        ".synopsis { color: #333; font-style: italic; }"
        ".note { color: #555; font-style: italic; }"
        ".lyric { margin-left: .75in; font-style: italic; }"
        ".centered { text-align: center; }"
        ".blank { height: 10pt; margin: 0; }"
        ".page-break { page-break-after: always; height: 0; margin: 0; padding: 0; }"
        ".synopsis-page { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; }"
        ".synopsis-page h1 { font-size: 20pt; margin: 0 0 18pt 0; }"
        ".synopsis-content { line-height: 1.35; }"
        ".synopsis-content p { margin: 0 0 8pt 0; line-height: 1.35; }"
        "</style></head><body>");
    html += formattedScriptHtml();
    html += QStringLiteral("</body></html>");
    return html;
}

QString MainWindow::analyticsPdfHtml() const
{
    const QString title = currentPath.isEmpty()
                              ? QStringLiteral("Untitled Screenplay")
                              : QFileInfo(currentPath).completeBaseName().toHtmlEscaped();

    QString synopsis;
    if (synopsisEdit->toPlainText().trimmed().isEmpty()) {
        synopsis = QStringLiteral("<p class=\"muted\">No generated synopsis or script report was available at export time.</p>");
    } else {
        QTextCursor cursor(synopsisEdit->document());
        cursor.select(QTextCursor::Document);
        synopsis = htmlBodyContents(QTextDocumentFragment(cursor).toHtml());
    }

    QString characterRows;
    for (const CharacterStats &stats : currentDocument.characters) {
        characterRows += QStringLiteral(
                             "<tr>"
                             "<td class=\"name\">%1</td>"
                             "<td>%2</td>"
                             "<td>%3</td>"
                             "<td>%4</td>"
                             "<td>%5</td>"
                             "</tr>")
                             .arg(stats.name.toHtmlEscaped())
                             .arg(stats.dialogueLines)
                             .arg(stats.dialogueWords)
                             .arg(stats.sceneCount)
                             .arg(durationText(stats.estimatedSeconds).toHtmlEscaped());
    }
    if (characterRows.isEmpty()) {
        characterRows = QStringLiteral("<tr><td colspan=\"5\" class=\"muted\">No character dialogue detected.</td></tr>");
    }

    QString diagnosticRows;
    const int diagnosticLimit = qMin(30, currentDocument.diagnostics.size());
    for (int i = 0; i < diagnosticLimit; ++i) {
        const FountainDiagnostic &diagnostic = currentDocument.diagnostics.at(i);
        diagnosticRows += QStringLiteral("<li><span>Line %1</span>%2</li>")
                              .arg(diagnostic.line + 1)
                              .arg(diagnostic.message.toHtmlEscaped());
    }
    if (currentDocument.diagnostics.size() > diagnosticLimit) {
        diagnosticRows += QStringLiteral("<li><span>More</span>%1 additional corrections omitted.</li>")
                              .arg(currentDocument.diagnostics.size() - diagnosticLimit);
    }
    if (diagnosticRows.isEmpty()) {
        diagnosticRows = QStringLiteral("<li><span>Status</span>No parser corrections flagged.</li>");
    }

    return QStringLiteral(
               "<!doctype html><html><head><meta charset=\"utf-8\">"
               "<style>"
               "body { font-family: Helvetica, Arial, sans-serif; color: #15171a; font-size: 10.5pt; }"
               "h1 { font-size: 24pt; margin: 0 0 4pt 0; color: #111827; }"
               "h2 { font-size: 13pt; margin: 22pt 0 8pt 0; color: #1f2937; border-bottom: 1px solid #d7dde5; padding-bottom: 4pt; }"
               "p { margin: 0 0 8pt 0; line-height: 1.35; }"
               ".dek { color: #5b6472; font-size: 10pt; margin-bottom: 18pt; }"
               ".metrics { width: 100%; border-collapse: collapse; margin: 10pt 0 16pt 0; }"
               ".metrics td { width: 25%; vertical-align: top; padding: 9pt; border: 1px solid #d7dde5; background: #f7f9fb; }"
               ".label { display: block; color: #667085; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; }"
               ".value { display: block; margin-top: 3pt; font-size: 15pt; font-weight: 700; color: #111827; }"
               "table.characters { width: 100%; border-collapse: collapse; margin-top: 6pt; }"
               "table.characters th { background: #1f2937; color: white; text-align: left; padding: 6pt; font-size: 9pt; }"
               "table.characters td { border-bottom: 1px solid #e2e7ee; padding: 6pt; }"
               "table.characters tr:nth-child(even) td { background: #f8fafc; }"
               ".name { font-weight: 700; }"
               ".synopsis { line-height: 1.4; }"
               ".synopsis h1, .synopsis h2, .synopsis h3 { font-size: 12pt; margin: 12pt 0 6pt 0; border: 0; padding: 0; }"
               ".synopsis ul, .synopsis ol { margin-top: 4pt; }"
               ".corrections { margin: 0; padding-left: 0; }"
               ".corrections li { list-style: none; margin: 0 0 5pt 0; padding: 5pt 7pt; background: #fff7ed; border-left: 3pt solid #f59e0b; }"
               ".corrections span { display: inline-block; min-width: 45pt; font-weight: 700; color: #92400e; }"
               ".muted { color: #667085; font-style: italic; }"
               "</style></head><body>"
               "<h1>%1 Analytics</h1>"
               "<p class=\"dek\">Parser metrics, character presence, corrections, and generated synopsis/report.</p>"
               "<table class=\"metrics\"><tr>"
               "<td><span class=\"label\">Scenes</span><span class=\"value\">%2</span></td>"
               "<td><span class=\"label\">Characters</span><span class=\"value\">%3</span></td>"
               "<td><span class=\"label\">Words</span><span class=\"value\">%4</span></td>"
               "<td><span class=\"label\">Estimated Runtime</span><span class=\"value\">%5</span></td>"
               "</tr></table>"
               "<h2>Generated Synopsis / Report</h2>"
               "<div class=\"synopsis\">%6</div>"
               "<h2>Character Presence</h2>"
               "<table class=\"characters\"><thead><tr><th>Character</th><th>Dialogue Lines</th><th>Words</th><th>Scenes</th><th>Est. Time</th></tr></thead><tbody>%7</tbody></table>"
               "<h2>Parser Corrections</h2>"
               "<ul class=\"corrections\">%8</ul>"
               "</body></html>")
        .arg(title)
        .arg(currentDocument.sceneCount)
        .arg(currentDocument.characters.size())
        .arg(currentDocument.wordCount)
        .arg(estimatedRuntimeText().toHtmlEscaped())
        .arg(synopsis)
        .arg(characterRows)
        .arg(diagnosticRows);
}

QString MainWindow::formattedScriptHtml() const
{
    QString html;
    for (const FountainLine &line : currentDocument.lines) {
        html += lineToHtml(line);
    }
    return html;
}

QString MainWindow::lineToHtml(const FountainLine &line) const
{
    const QString text = line.text.trimmed().toHtmlEscaped();
    if (line.type == FountainLineType::Empty) {
        return QStringLiteral("<p class=\"blank\">&nbsp;</p>");
    }
    if (line.type == FountainLineType::PageBreak) {
        return QStringLiteral("<div class=\"page-break\"></div>");
    }

    switch (line.type) {
    case FountainLineType::TitlePage: {
        const int colon = text.indexOf(':');
        if (colon > 0) {
            return QStringLiteral("<p class=\"title\"><span class=\"key\">%1</span>%2</p>")
                .arg(text.left(colon + 1), text.mid(colon + 1));
        }
        return QStringLiteral("<p class=\"title\">%1</p>").arg(text);
    }
    case FountainLineType::SceneHeading:
        return QStringLiteral("<p class=\"scene\">%1</p>").arg(text);
    case FountainLineType::Character:
        return QStringLiteral("<p class=\"character\">%1</p>").arg(text);
    case FountainLineType::Parenthetical:
        return QStringLiteral("<p class=\"parenthetical\">%1</p>").arg(text);
    case FountainLineType::Dialogue:
        return QStringLiteral("<p class=\"dialogue\">%1</p>").arg(text);
    case FountainLineType::Transition:
        return QStringLiteral("<p class=\"transition\">%1</p>").arg(text);
    case FountainLineType::Section:
        return QStringLiteral("<p class=\"section\">%1</p>").arg(text);
    case FountainLineType::Synopsis:
        return QStringLiteral("<p class=\"synopsis\">%1</p>").arg(text);
    case FountainLineType::Note:
        return QStringLiteral("<p class=\"note\">%1</p>").arg(text);
    case FountainLineType::Lyric:
        return QStringLiteral("<p class=\"lyric\">%1</p>").arg(text);
    case FountainLineType::Centered:
        return QStringLiteral("<p class=\"centered\">%1</p>").arg(text);
    case FountainLineType::Action:
    default:
        return QStringLiteral("<p class=\"action\">%1</p>").arg(text);
    }
}

bool MainWindow::maybeSave()
{
    if (!editor->document()->isModified()) {
        return true;
    }

    const QMessageBox::StandardButton choice = QMessageBox::question(
        this,
        QStringLiteral("Unsaved Changes"),
        QStringLiteral("Save changes before continuing?"),
        QMessageBox::Save | QMessageBox::Discard | QMessageBox::Cancel,
        QMessageBox::Save);

    if (choice == QMessageBox::Cancel) {
        return false;
    }
    if (choice == QMessageBox::Save) {
        if (currentPath.isEmpty()) {
            saveDocumentAs();
            return !editor->document()->isModified();
        }
        return saveToPath(currentPath);
    }
    return true;
}

void MainWindow::applySelectedFix()
{
    QListWidgetItem *selected = diagnosticsList->currentItem();
    if (!selected) {
        statusBar()->showMessage(QStringLiteral("Select a correction first."), 2500);
        return;
    }

    const int index = selected->data(Qt::UserRole).toInt();
    if (index < 0 || index >= currentDocument.diagnostics.size()) {
        return;
    }

    const FountainDiagnostic diagnostic = currentDocument.diagnostics.at(index);
    QTextCursor cursor(editor->document());
    cursor.setPosition(diagnostic.start);
    cursor.setPosition(diagnostic.start + diagnostic.length, QTextCursor::KeepAnchor);
    cursor.insertText(diagnostic.replacement);
    editor->setTextCursor(cursor);
    analyze();
}

QString MainWindow::selectedCharacterName() const
{
    const auto selection = characterTable->selectionModel()->selectedRows();
    if (selection.isEmpty()) {
        return {};
    }
    return characterTable->item(selection.first().row(), 0)->text();
}

QString MainWindow::characterPrompt(const QString &name) const
{
    QStringList samples;
    int dialogueLines = 0;
    int dialogueWords = 0;
    int sceneCount = 0;
    QString estimatedPresence;
    for (const CharacterStats &stats : currentDocument.characters) {
        if (stats.name == name) {
            samples = stats.sampleLines;
            dialogueLines = stats.dialogueLines;
            dialogueWords = stats.dialogueWords;
            sceneCount = stats.sceneCount;
            estimatedPresence = durationText(stats.estimatedSeconds);
            break;
        }
    }

    return QStringLiteral(
               "You are analyzing a screenplay or stageplay written in Fountain format. "
               "Write a concise but complete character synopsis for %1. Focus on how the character comes across, "
               "their relationships, story function, and how their role changes from early scenes to late scenes. "
               "Use the cross-script evidence below. Do not assume the character is minor just because their first scene is small. "
               "Avoid inventing plot facts. Format important character names in Markdown bold, like **%1**.\n\n"
               "Character metrics:\n"
               "- Dialogue lines: %2\n"
               "- Dialogue words: %3\n"
               "- Scenes with dialogue: %4\n"
               "- Estimated presence: %5\n\n"
               "Sample %1 dialogue:\n%6\n\n"
               "Cross-script evidence for %1:\n%7")
        .arg(name)
        .arg(dialogueLines)
        .arg(dialogueWords)
        .arg(sceneCount)
        .arg(estimatedPresence.isEmpty() ? QStringLiteral("unknown") : estimatedPresence)
        .arg(samples.join(QStringLiteral("\n")))
        .arg(characterEvidenceText(name));
}

QString MainWindow::finalCharacterPrompt(const QString &name, const QStringList &summaries) const
{
    return QStringLiteral(
               "You are analyzing a screenplay or stageplay. Write a concise but complete character synopsis for %1. "
               "Use the chunk summaries, which cover the full script evidence available for this character. "
               "Focus on personality, relationships, story function, and how the character changes over time. "
               "Call out important late-script developments. Avoid inventing facts. Format important character names in Markdown bold, like **%1**.\n\n"
               "Character metrics:\n%2\n\n"
               "Full-script character evidence summaries:\n%3")
        .arg(name)
        .arg(characterSummaryText(12))
        .arg(summaries.join(QStringLiteral("\n\n---\n\n")));
}

QString MainWindow::characterEvidenceText(const QString &name, int maxChars) const
{
    QStringList chunks;
    QStringList sceneLines;
    QString sceneHeading = QStringLiteral("Opening");
    int sceneNumber = 0;
    int activeSceneNumber = 0;
    bool relevant = false;
    const QString target = name.trimmed();

    auto flushScene = [&]() {
        if (!relevant || sceneLines.isEmpty()) {
            sceneLines.clear();
            relevant = false;
            return;
        }

        QStringList compact;
        int kept = 0;
        for (const QString &line : sceneLines) {
            const QString trimmed = line.trimmed();
            if (trimmed.isEmpty()) {
                continue;
            }
            compact << trimmed;
            ++kept;
            if (kept >= 46) {
                compact << QStringLiteral("[scene excerpt trimmed]");
                break;
            }
        }

        chunks << QStringLiteral("Scene %1: %2\n%3")
                      .arg(activeSceneNumber)
                      .arg(sceneHeading)
                      .arg(compact.join(QStringLiteral("\n")));
        sceneLines.clear();
        relevant = false;
    };

    for (const FountainLine &line : currentDocument.lines) {
        if (line.type == FountainLineType::SceneHeading) {
            flushScene();
            ++sceneNumber;
            activeSceneNumber = sceneNumber;
            sceneHeading = line.text.trimmed();
            sceneLines << line.text;
            if (line.text.contains(target, Qt::CaseInsensitive)) {
                relevant = true;
            }
            continue;
        }

        sceneLines << line.text;
        if (line.character.compare(target, Qt::CaseInsensitive) == 0
            || line.text.contains(target, Qt::CaseInsensitive)) {
            relevant = true;
        }
    }
    flushScene();

    if (chunks.isEmpty()) {
        return QStringLiteral("No scenes mentioning %1 were found.").arg(name);
    }

    QStringList selected;
    const int chunkCount = chunks.size();
    const int desired = qMin(chunkCount, 14);
    for (int i = 0; i < desired; ++i) {
        const int index = desired == 1 ? 0 : qRound((chunkCount - 1) * (double(i) / double(desired - 1)));
        if (!selected.contains(chunks.at(index))) {
            selected << chunks.at(index);
        }
    }

    QString evidence = selected.join(QStringLiteral("\n\n---\n\n"));
    if (evidence.size() > maxChars) {
        evidence = evidence.left(maxChars) + QStringLiteral("\n[additional character evidence omitted for prompt size]");
    }

    return QStringLiteral("The following scenes were sampled from across the full script, not only the opening pages.\n\n%1")
        .arg(evidence);
}

QString MainWindow::estimatedRuntimeText() const
{
    const QStringList lines = editor->toPlainText().split('\n');
    int contentLines = 0;
    for (const QString &line : lines) {
        if (!line.trimmed().isEmpty()) {
            ++contentLines;
        }
    }

    const double wordEstimate = currentDocument.wordCount / 175.0;
    const double lineEstimate = contentLines / 55.0;
    const double sceneEstimate = currentDocument.sceneCount * 0.65;
    const double minutes = qMax(1.0, (wordEstimate * 0.45) + (lineEstimate * 0.45) + (sceneEstimate * 0.10));
    return minutesText(minutes);
}

QString MainWindow::characterSummaryText(int limit) const
{
    QStringList rows;
    const int count = qMin(limit, currentDocument.characters.size());
    for (int i = 0; i < count; ++i) {
        const CharacterStats &stats = currentDocument.characters.at(i);
        rows << QStringLiteral("- %1: %2 dialogue lines, %3 words, %4 scenes, estimated presence %5")
                    .arg(stats.name)
                    .arg(stats.dialogueLines)
                    .arg(stats.dialogueWords)
                    .arg(stats.sceneCount)
                    .arg(durationText(stats.estimatedSeconds));
    }
    return rows.isEmpty() ? QStringLiteral("- No character dialogue detected yet.") : rows.join(QStringLiteral("\n"));
}

QString MainWindow::sceneOutlineText(int limit) const
{
    QStringList rows;
    int sceneNumber = 0;
    for (const FountainLine &line : currentDocument.lines) {
        if (line.type != FountainLineType::SceneHeading) {
            continue;
        }
        ++sceneNumber;
        if (rows.size() >= limit) {
            rows << QStringLiteral("- ...additional scenes omitted from outline");
            break;
        }
        rows << QStringLiteral("- %1. %2").arg(sceneNumber).arg(line.text.trimmed());
    }
    return rows.isEmpty() ? QStringLiteral("- No scene headings detected.") : rows.join(QStringLiteral("\n"));
}

QString MainWindow::scriptWideExcerpt(int maxChars) const
{
    const QString text = editor->toPlainText();
    if (text.size() <= maxChars) {
        return text;
    }

    const int slice = maxChars / 3;
    const int middleStart = qMax(0, (text.size() / 2) - (slice / 2));
    const int endStart = qMax(0, text.size() - slice);

    return QStringLiteral(
               "[Opening excerpt]\n%1\n\n"
               "[Middle excerpt]\n%2\n\n"
               "[Ending excerpt]\n%3\n\n"
               "[Full script is longer than the prompt budget; these excerpts intentionally sample the beginning, middle, and end.]")
        .arg(text.left(slice))
        .arg(text.mid(middleStart, slice))
        .arg(text.mid(endStart, slice));
}

QStringList MainWindow::scriptAnalysisChunks(int maxChars) const
{
    QStringList chunks;
    QString current;
    int sceneNumber = 0;

    for (const FountainLine &line : currentDocument.lines) {
        QString rendered = line.text;
        if (line.type == FountainLineType::SceneHeading) {
            ++sceneNumber;
            rendered = QStringLiteral("\nScene %1: %2").arg(sceneNumber).arg(line.text.trimmed());
        }

        if (!current.isEmpty() && current.size() + rendered.size() + 1 > maxChars) {
            chunks << current.trimmed();
            current.clear();
        }
        current += rendered + QLatin1Char('\n');
    }

    if (!current.trimmed().isEmpty()) {
        chunks << current.trimmed();
    }
    return chunks;
}

QStringList MainWindow::characterAnalysisChunks(const QString &name, int maxChars) const
{
    QStringList relevantScenes;
    QStringList sceneLines;
    QString sceneHeading = QStringLiteral("Opening");
    int sceneNumber = 0;
    int activeSceneNumber = 0;
    bool relevant = false;
    const QString target = name.trimmed();

    auto flushScene = [&]() {
        if (relevant && !sceneLines.isEmpty()) {
            relevantScenes << QStringLiteral("Scene %1: %2\n%3")
                                  .arg(activeSceneNumber)
                                  .arg(sceneHeading)
                                  .arg(sceneLines.join(QStringLiteral("\n")).trimmed());
        }
        sceneLines.clear();
        relevant = false;
    };

    for (const FountainLine &line : currentDocument.lines) {
        if (line.type == FountainLineType::SceneHeading) {
            flushScene();
            ++sceneNumber;
            activeSceneNumber = sceneNumber;
            sceneHeading = line.text.trimmed();
            sceneLines << line.text;
            if (line.text.contains(target, Qt::CaseInsensitive)) {
                relevant = true;
            }
            continue;
        }

        sceneLines << line.text;
        if (line.character.compare(target, Qt::CaseInsensitive) == 0
            || line.text.contains(target, Qt::CaseInsensitive)) {
            relevant = true;
        }
    }
    flushScene();

    QStringList chunks;
    QString current;
    for (const QString &scene : relevantScenes) {
        if (!current.isEmpty() && current.size() + scene.size() + 5 > maxChars) {
            chunks << current.trimmed();
            current.clear();
        }
        current += scene + QStringLiteral("\n\n---\n\n");
    }
    if (!current.trimmed().isEmpty()) {
        chunks << current.trimmed();
    }
    return chunks;
}

QString MainWindow::scriptReportPrompt() const
{
    return QStringLiteral(
               "You are analyzing a screenplay or stageplay written in Fountain format. "
               "Create a concise whole-script report with these exact headings:\n"
               "Synopsis\n"
               "Rating Recommendation\n"
               "What The Rating Is Based On\n"
               "Estimated Runtime\n"
               "Audience / Market Fit\n"
               "Character Balance\n"
               "Revision Notes\n\n"
               "Do not omit any heading. Rating Recommendation and What The Rating Is Based On are required even when uncertain. "
               "For Rating Recommendation, choose a likely US-style film/content rating such as G, PG, PG-13, R, or NC-17, "
               "or say Not enough evidence if the excerpt is too incomplete. Also include a recommended audience age range, such as 8+, 10+, 13+, 16+, or 17+. "
               "For What The Rating Is Based On, explain the visible content behind that recommendation, including violence, language, sex/nudity, drugs/alcohol, thematic intensity, or lack of those elements. "
               "Base it only on visible content, not invented content. "
               "For Estimated Runtime, use the provided parser estimate and explain briefly that it is a rough estimate from words, non-empty lines, and scene count. "
               "Format important character names in Markdown bold, like **CHARACTER NAME**.\n\n"
               "Parser metrics:\n"
               "- Scenes: %1\n"
               "- Characters: %2\n"
               "- Words: %3\n"
               "- Estimated runtime: %4\n"
               "- Corrections flagged: %5\n\n"
               "Scene outline:\n%6\n\n"
               "Character balance:\n%7\n\n"
               "Script excerpts sampled from across the full script:\n%8")
        .arg(currentDocument.sceneCount)
        .arg(currentDocument.characters.size())
        .arg(currentDocument.wordCount)
        .arg(estimatedRuntimeText())
        .arg(currentDocument.diagnostics.size())
        .arg(sceneOutlineText())
        .arg(characterSummaryText())
        .arg(scriptWideExcerpt());
}

QString MainWindow::finalScriptReportPrompt(const QStringList &summaries) const
{
    return QStringLiteral(
               "You are analyzing a screenplay or stageplay. Create a concise whole-script report with these exact headings:\n"
               "Synopsis\n"
               "Rating Recommendation\n"
               "What The Rating Is Based On\n"
               "Estimated Runtime\n"
               "Audience / Market Fit\n"
               "Character Balance\n"
               "Revision Notes\n\n"
               "The chunk summaries below cover the full script in order. Base the report on all of them, including late-script developments. "
               "Do not omit any heading. Rating Recommendation and What The Rating Is Based On are required even when uncertain. "
               "For Rating Recommendation, choose a likely US-style film/content rating such as G, PG, PG-13, R, or NC-17, "
               "or say Not enough evidence if needed. Also include a recommended audience age range, such as 8+, 10+, 13+, 16+, or 17+. "
               "For What The Rating Is Based On, explain the visible content behind that recommendation, including violence, language, sex/nudity, drugs/alcohol, thematic intensity, or lack of those elements. "
               "Avoid inventing facts. Format important character names in Markdown bold, like **CHARACTER NAME**.\n\n"
               "Parser metrics:\n"
               "- Scenes: %1\n"
               "- Characters: %2\n"
               "- Words: %3\n"
               "- Estimated runtime: %4\n"
               "- Corrections flagged: %5\n\n"
               "Scene outline:\n%6\n\n"
               "Character balance:\n%7\n\n"
               "Full-script chunk summaries:\n%8")
        .arg(currentDocument.sceneCount)
        .arg(currentDocument.characters.size())
        .arg(currentDocument.wordCount)
        .arg(estimatedRuntimeText())
        .arg(currentDocument.diagnostics.size())
        .arg(sceneOutlineText())
        .arg(characterSummaryText())
        .arg(summaries.join(QStringLiteral("\n\n---\n\n")));
}

QString MainWindow::normalizeScriptReportResponse(const QString &response) const
{
    if (response.trimmed().isEmpty() || hasRequiredRatingSections(response)) {
        return response;
    }

    return response.trimmed()
           + QStringLiteral(
               "\n\nRating Recommendation\n"
               "Not enough evidence to determine confidently from the model response; recommended age range needs review.\n\n"
               "What The Rating Is Based On\n"
               "The local model omitted the required rating section after a repair attempt. Review the script for violence, language, sex/nudity, drugs/alcohol, and thematic intensity, then regenerate the report if needed.");
}

void MainWindow::setAnalysisMarkdown(const QString &text)
{
    synopsisEdit->setMarkdown(text);
}

void MainWindow::generateSynopsis()
{
    const QString name = selectedCharacterName();
    if (name.isEmpty()) {
        synopsisEdit->setPlainText(QStringLiteral("Select a character first."));
        return;
    }

    const QStringList chunks = characterAnalysisChunks(name);
    if (chunks.isEmpty()) {
        synopsisEdit->setPlainText(QStringLiteral("No script evidence was found for %1.").arg(name));
        return;
    }
    startChunkedAnalysis(QStringLiteral("character"), name, chunks);
}

void MainWindow::generateScriptReport()
{
    if (editor->toPlainText().trimmed().isEmpty()) {
        synopsisEdit->setPlainText(QStringLiteral("Write or open a script before generating a script report."));
        return;
    }

    startChunkedAnalysis(QStringLiteral("script"), QString(), scriptAnalysisChunks());
}

void MainWindow::startChunkedAnalysis(const QString &mode, const QString &subject, const QStringList &chunks)
{
    activeAnalysisMode = mode;
    activeAnalysisSubject = subject;
    activeAnalysisChunks = chunks;
    activeAnalysisSummaries.clear();
    activeAnalysisIndex = 0;
    synopsisButton->setEnabled(false);
    scriptReportButton->setEnabled(false);
    sendNextAnalysisChunk();
}

void MainWindow::sendNextAnalysisChunk()
{
    if (activeAnalysisIndex >= activeAnalysisChunks.size()) {
        sendFinalAnalysisRequest();
        return;
    }

    const int displayIndex = activeAnalysisIndex + 1;
    const int total = activeAnalysisChunks.size();
    const bool isCharacter = activeAnalysisMode == QStringLiteral("character");
    synopsisEdit->setPlainText(isCharacter
                                   ? QStringLiteral("Analyzing %1 evidence chunk %2 of %3...")
                                         .arg(activeAnalysisSubject)
                                         .arg(displayIndex)
                                         .arg(total)
                                   : QStringLiteral("Analyzing script chunk %1 of %2...")
                                         .arg(displayIndex)
                                         .arg(total));

    const QString prompt = isCharacter
                               ? QStringLiteral(
                                     "Summarize this script excerpt only for evidence about %1. "
                                     "Capture relationship developments, plot function, emotional behavior, conflicts, and any changes. "
                                     "Do not invent facts. If the excerpt contains little evidence, say so briefly.\n\n%2")
                                     .arg(activeAnalysisSubject, activeAnalysisChunks.at(activeAnalysisIndex))
                               : QStringLiteral(
                                     "Summarize this screenplay/stageplay excerpt. Capture plot events, character developments, conflicts, tone, "
                                     "rating-relevant content, and any important setup/payoff. Do not invent facts.\n\n%1")
                                     .arg(activeAnalysisChunks.at(activeAnalysisIndex));

    QJsonObject payload;
    payload.insert(QStringLiteral("model"), recommendedModel());
    payload.insert(QStringLiteral("prompt"), prompt);
    payload.insert(QStringLiteral("stream"), false);

    QNetworkRequest request(QUrl(QStringLiteral("http://localhost:11434/api/generate")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QNetworkReply *reply = network.post(request, QJsonDocument(payload).toJson(QJsonDocument::Compact));
    reply->setProperty("analysisStage", "chunk");
    connect(reply, &QNetworkReply::finished, this, &MainWindow::handleOllamaReply);
}

void MainWindow::sendFinalAnalysisRequest()
{
    synopsisEdit->setPlainText(activeAnalysisMode == QStringLiteral("character")
                                   ? QStringLiteral("Synthesizing full-script character synopsis for %1...")
                                         .arg(activeAnalysisSubject)
                                   : QStringLiteral("Synthesizing full-script report..."));

    const QString prompt = activeAnalysisMode == QStringLiteral("character")
                               ? finalCharacterPrompt(activeAnalysisSubject, activeAnalysisSummaries)
                               : finalScriptReportPrompt(activeAnalysisSummaries);

    QJsonObject payload;
    payload.insert(QStringLiteral("model"), recommendedModel());
    payload.insert(QStringLiteral("prompt"), prompt);
    payload.insert(QStringLiteral("stream"), false);

    QNetworkRequest request(QUrl(QStringLiteral("http://localhost:11434/api/generate")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QNetworkReply *reply = network.post(request, QJsonDocument(payload).toJson(QJsonDocument::Compact));
    reply->setProperty("analysisStage", "final");
    connect(reply, &QNetworkReply::finished, this, &MainWindow::handleOllamaReply);
}

void MainWindow::sendScriptReportRepairRequest(const QString &previousResponse)
{
    synopsisEdit->setPlainText(QStringLiteral("Adding required rating recommendation to script report..."));

    const QString prompt = QStringLiteral(
                               "Revise the previous whole-script report so it includes every required heading exactly once:\n"
                               "Synopsis\n"
                               "Rating Recommendation\n"
                               "What The Rating Is Based On\n"
                               "Estimated Runtime\n"
                               "Audience / Market Fit\n"
                               "Character Balance\n"
                               "Revision Notes\n\n"
                               "The Rating Recommendation section is required. Choose a likely US-style film/content rating "
                               "(G, PG, PG-13, R, or NC-17) and include a recommended audience age range, or say Not enough evidence. "
                               "The What The Rating Is Based On section is required and must explain visible evidence such as violence, "
                               "language, sex/nudity, drugs/alcohol, thematic intensity, or the absence of those elements. "
                               "Do not invent facts. Format important character names in Markdown bold, like **CHARACTER NAME**.\n\n"
                               "Parser metrics:\n"
                               "- Scenes: %1\n"
                               "- Characters: %2\n"
                               "- Words: %3\n"
                               "- Estimated runtime: %4\n\n"
                               "Previous report:\n%5\n\n"
                               "Full-script chunk summaries:\n%6")
                               .arg(currentDocument.sceneCount)
                               .arg(currentDocument.characters.size())
                               .arg(currentDocument.wordCount)
                               .arg(estimatedRuntimeText())
                               .arg(previousResponse)
                               .arg(activeAnalysisSummaries.join(QStringLiteral("\n\n---\n\n")));

    QJsonObject payload;
    payload.insert(QStringLiteral("model"), recommendedModel());
    payload.insert(QStringLiteral("prompt"), prompt);
    payload.insert(QStringLiteral("stream"), false);

    QNetworkRequest request(QUrl(QStringLiteral("http://localhost:11434/api/generate")));
    request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
    QNetworkReply *reply = network.post(request, QJsonDocument(payload).toJson(QJsonDocument::Compact));
    reply->setProperty("analysisStage", "finalRepair");
    connect(reply, &QNetworkReply::finished, this, &MainWindow::handleOllamaReply);
}

void MainWindow::handleOllamaReply()
{
    auto *reply = qobject_cast<QNetworkReply *>(sender());
    if (!reply) {
        synopsisButton->setEnabled(ollamaModelReady);
        scriptReportButton->setEnabled(ollamaModelReady);
        return;
    }

    const QByteArray body = reply->readAll();
    if (reply->error() != QNetworkReply::NoError) {
        synopsisEdit->setPlainText(QStringLiteral("Ollama request failed: %1").arg(reply->errorString()));
        synopsisButton->setEnabled(ollamaModelReady);
        scriptReportButton->setEnabled(ollamaModelReady);
        reply->deleteLater();
        return;
    }

    const QJsonDocument json = QJsonDocument::fromJson(body);
    const QString response = json.object().value(QStringLiteral("response")).toString().trimmed();
    const QString stage = reply->property("analysisStage").toString();
    if (stage == QStringLiteral("chunk")) {
        activeAnalysisSummaries << (response.isEmpty() ? QStringLiteral("[No summary returned for this chunk.]") : response);
        ++activeAnalysisIndex;
        reply->deleteLater();
        sendNextAnalysisChunk();
        return;
    }

    if (stage == QStringLiteral("final")
        && activeAnalysisMode == QStringLiteral("script")
        && !response.isEmpty()
        && !hasRequiredRatingSections(response)) {
        reply->deleteLater();
        sendScriptReportRepairRequest(response);
        return;
    }

    const QString finalResponse = response.isEmpty()
                                      ? QStringLiteral("Ollama returned no synopsis.")
                                      : (stage == QStringLiteral("finalRepair") ? normalizeScriptReportResponse(response) : response);
    setAnalysisMarkdown(finalResponse);
    activeAnalysisMode.clear();
    activeAnalysisSubject.clear();
    activeAnalysisChunks.clear();
    activeAnalysisSummaries.clear();
    activeAnalysisIndex = 0;
    synopsisButton->setEnabled(ollamaModelReady);
    scriptReportButton->setEnabled(ollamaModelReady);
    reply->deleteLater();
}
