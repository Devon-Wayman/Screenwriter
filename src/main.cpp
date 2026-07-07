#include "MainWindow.h"

#include <QApplication>

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    QApplication::setApplicationName(QStringLiteral("Screenwriter"));
    QApplication::setOrganizationName(QStringLiteral("Local"));

    MainWindow window;
    window.show();

    return app.exec();
}
