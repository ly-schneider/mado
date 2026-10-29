"""Regenerate packages/ui/src/fluent.tsx from @fluentui/svg-icons.

Usage: npm pack @fluentui/svg-icons && tar xzf fluentui-svg-icons-*.tgz
       python3 scripts/gen-fluent-icons.py path/to/package/icons
Add new icons to MAP (app name -> Fluent base name).
"""
import json, re, sys

MAP = {
    "Archive": "archive", "ArrowDown": "arrow_down", "ArrowRight": "arrow_right", "ArrowUp": "arrow_up",
    "ArrowUpRight": "arrow_up_right", "Bell": "alert", "BookOpen": "book_open", "Bot": "bot", "Brain": "brain_circuit",
    "Briefcase": "briefcase", "Bug": "bug", "Building2": "building", "Calendar": "calendar", "CalendarDays": "calendar_ltr",
    "Check": "checkmark", "ChevronDown": "chevron_down", "ChevronLeft": "chevron_left", "ChevronRight": "chevron_right",
    "ChevronsUpDown": "chevron_up_down", "CircleCheck": "checkmark_circle", "CircleDashed": "circle_hint",
    "CircleUser": "person_circle", "Clock": "clock", "Copy": "copy", "CornerDownLeft": "arrow_enter_left",
    "Ellipsis": "more_horizontal", "Eye": "eye", "EyeOff": "eye_off", "FileDown": "document_arrow_down",
    "FilePlus": "document_add", "FileText": "document_text", "Folder": "folder", "FolderInput": "folder_arrow_right",
    "FolderKanban": "folder_list", "FolderOpen": "folder_open", "GitBranch": "branch", "GitCommitHorizontal": "circle_line",
    "GitPullRequest": "branch_request", "Globe": "globe", "History": "history", "Inbox": "mail_inbox", "Info": "info",
    "KeyRound": "key", "Lightbulb": "lightbulb", "Link2": "link", "Link2Off": "link_dismiss", "List": "text_bullet_list",
    "ListFilter": "filter", "Lock": "lock_closed", "LogOut": "sign_out", "Mail": "mail", "MailOpen": "mail_read",
    "MessageSquare": "chat", "Mic": "mic", "Monitor": "desktop", "Moon": "weather_moon", "MoreHorizontal": "more_horizontal",
    "Palette": "color", "PanelLeft": "panel_left", "PanelRight": "panel_right", "Pencil": "edit", "PenLine": "pen",
    "Plus": "add", "RotateCcw": "arrow_counterclockwise", "Search": "search", "Settings2": "settings", "Share": "share",
    "ShieldCheck": "shield_checkmark", "SlidersHorizontal": "options", "Sparkles": "sparkle", "SquareKanban": "grid_kanban",
    "SquarePen": "compose", "Star": "star", "Sun": "weather_sunny", "Tag": "tag", "Trash2": "delete",
    "TriangleAlert": "warning", "Undo2": "arrow_undo", "User": "person", "Users": "people", "X": "dismiss", "Zap": "flash",
}

HEADER = open(__file__.replace("gen-fluent-icons.py", "fluent-header.tsx")).read()


def paths(icons, name, weight):
    svg = open(f"{icons}/{name}_20_{weight}.svg").read()
    return re.findall(r'<path d="([^"]+)"\s*/>', svg)


if __name__ == "__main__":
    icons = sys.argv[1]
    lines = [HEADER]
    for app_name, fluent in sorted(MAP.items()):
        lines.append(f"export const {app_name} = icon({json.dumps(paths(icons, fluent, 'regular'))}, {json.dumps(paths(icons, fluent, 'filled'))});")
    open("packages/ui/src/fluent.tsx", "w").write("\n".join(lines) + "\n")
