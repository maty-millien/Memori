APP_CSS = """
Screen { background: ansi_default; color: ansi_default; }
#conversation { background: ansi_default; padding: 0 1; scrollbar-size: 0 0; }
.user-turn {
    color: ansi_bright_cyan;
    text-style: bold;
    padding-top: 1;
    background: ansi_default;
}
.system-turn {
    color: ansi_bright_green;
    text-style: italic;
    padding-top: 1;
    background: ansi_default;
}
.reasoning {
    color: ansi_bright_black;
    text-opacity: 70%;
    text-style: italic;
    background: ansi_default;
    border-left: outer ansi_bright_black;
    padding: 0 0 0 1;
    margin: 0;
}
.tool-call {
    color: ansi_bright_yellow;
    background: ansi_default;
    border-left: outer ansi_yellow;
    padding: 0 0 0 1;
    margin: 0 0 1 0;
}
.tool-call.after-text { margin: 1 0 1 0; }
.summarize {
    color: ansi_bright_magenta;
    background: ansi_default;
    border-left: outer ansi_magenta;
    padding: 0 0 0 1;
    margin: 0;
}
.assistant-turn {
    padding-bottom: 1;
    margin-top: 1;
    height: auto;
    background: ansi_default;
}
.thinking-indicator {
    height: 1;
    width: 100%;
    color: ansi_bright_black;
    text-opacity: 80%;
    text-style: italic;
    background: ansi_default;
    margin: 0;
    padding: 0 0 0 1;
}
.thinking-indicator.after-stream { margin: 1 0 0 0; }
.assistant-content {
    background: ansi_default;
    color: ansi_default;
    margin: 1 0 0 0;
    padding: 0 0 0 1;
    border-left: outer ansi_bright_blue;
}
#input-area {
    dock: bottom;
    height: auto;
    background: ansi_default;
}
Input {
    background: ansi_default;
    color: ansi_default;
    border: round ansi_bright_black;
    padding: 0 1;
    margin: 0 1 0 1;
}
Input:focus { border: round ansi_default; }
Input > .input--suggestion { color: ansi_bright_black; }
#command-suggestions {
    height: auto;
    max-height: 7;
    margin: 0 1;
    padding: 0 1;
    border: round ansi_bright_black;
    background: ansi_default;
}
.command-suggestion-row {
    height: 1;
    color: ansi_bright_black;
    background: ansi_default;
}
.command-suggestion-row.selected {
    color: ansi_default;
    background: ansi_bright_blue;
    text-style: bold;
}
#status-bar {
    height: 1;
    background: ansi_default;
    color: ansi_bright_black;
    padding: 0 2;
    margin: 0 1 1 1;
}
#status-bar-left { width: 1fr; height: 1; content-align: left middle; }
#status-bar-right { width: 1fr; height: 1; content-align: right middle; }
"""
