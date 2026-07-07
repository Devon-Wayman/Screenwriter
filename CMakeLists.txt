cmake_minimum_required(VERSION 3.21)

project(Screenwriter VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Network PrintSupport)

qt_add_executable(Screenwriter
    resources/resources.qrc
    src/Fountain.cpp
    src/Fountain.h
    src/FountainHighlighter.cpp
    src/FountainHighlighter.h
    src/MainWindow.cpp
    src/MainWindow.h
    src/main.cpp
)

target_link_libraries(Screenwriter PRIVATE Qt6::Widgets Qt6::Network Qt6::PrintSupport)

install(TARGETS Screenwriter
    BUNDLE DESTINATION .
    RUNTIME DESTINATION bin
)

if(APPLE)
    set_target_properties(Screenwriter PROPERTIES
        MACOSX_BUNDLE TRUE
        MACOSX_BUNDLE_BUNDLE_NAME "Screenwriter"
        MACOSX_BUNDLE_GUI_IDENTIFIER "dev.local.Screenwriter"
    )
endif()

set(CPACK_PACKAGE_NAME "Screenwriter")
set(CPACK_PACKAGE_VENDOR "Local")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
include(CPack)
