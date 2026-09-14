"""Sessions without a folder of their own still need somewhere safe to write."""

from pathlib import Path

from rafiq_agent.core.workspace import session_dir, slugify, workspace_root


def test_workspace_root_exists_and_is_a_folder():
    root = workspace_root()
    assert root.is_dir()


def test_slugify_keeps_arabic_and_drops_path_characters():
    assert slugify("ترتيب: ملفات/المشروع *v2") == "ترتيب-ملفات-المشروع-v2"


def test_slugify_falls_back_when_nothing_survives():
    assert slugify("///", fallback="task") == "task"


def test_session_dir_is_created_and_named_after_the_session():
    folder = session_dir("tasks", "abcdef123456", "ترتيب الملفات")
    assert folder.is_dir()
    assert folder.name == "ترتيب-الملفات-abcdef"
    assert folder.parent.name == "tasks"


def test_two_sessions_with_the_same_title_do_not_collide():
    a = session_dir("tasks", "aaaaaa111111", "نفس الاسم")
    b = session_dir("tasks", "bbbbbb222222", "نفس الاسم")
    assert a != b


def test_session_dir_stays_under_the_workspace():
    folder: Path = session_dir("designs", "ccccccdddddd", "تصميم")
    assert workspace_root() in folder.parents
