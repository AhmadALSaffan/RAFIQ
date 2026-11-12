"""`rafiq` with no command: Rafiq in the terminal, an interactive chat on the current folder.

Like a coding agent in the terminal: type what you want, the reply streams, each tool call shows
with its result, and a step that needs permission asks right there. It doesn't need the app
open: when no agent is running, `rafiq` starts one in the background for this session and
stops it on the way out; when the app opens meanwhile, the app's agent takes over and the
terminal reconnects to it (same data, same chat). Every setting, permission and limit of the
app applies.

    rafiq                  start on the current folder with the first model
    rafiq --model NAME     with another model
    rafiq --lang en        in English (ar, en, ru; /lang switches it and remembers)
    rafiq "what to do"     start with that message
    rafiq -c / -r          continue the last chat in this folder / pick one
    rafiq -p "what to do"  print mode: one reply on stdout and out (pipe text in too;
                           --yes allows steps that need permission, --output-format json)

Commands (/help lists them): /model, /mode, /lang, /new, /clear, /resume, /compact, /cost, /status,
/init, /memory, /tasks, /mcp, /skills, /folder, /exit. A line starting with ! runs a command
here (its output goes with the next message), one starting with # is kept in Rafiq's memory.
Modes (Shift+Tab, or /mode): ask, accept edits, plan only, don't ask.

This file is the engine and the plain view (pipes, tests); tui.py draws it in a real terminal.
"""

from __future__ import annotations

import contextlib
import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import IO, Any

from rafiq_agent.acp import AgentApi, tool_title

MAX_RESULT_LINES = 4
MAX_SHELL_LINES = 30
ORANGE = "#e98a32"

MODES = ("ask", "edits", "plan", "auto")
# What "accept edits" lets through without asking: writing the user's files.
EDIT_TOOLS = frozenset({"filesystem_write", "filesystem_edit", "word_write", "slides_write", "excel_write", "note_create", "note_edit"})

TEXTS: dict[str, dict[str, str]] = {
    "ar": {
        "banner": "رفيق · {model} · {folder}",
        "hint": "اكتب طلبك، أو /help للأوامر. Ctrl+C بيوقف الرد.",
        "help_title": "الأوامر",
        "help_more": "! أمر بيشتغل هون ونتيجته بتروح مع رسالتك الجاية · # نص بينحفظ بذاكرة رفيق · @ ملف\nShift+Tab بيبدّل الوضع · Ctrl+J أو Alt+Enter سطر جديد · Esc أو Ctrl+C بيوقف الرد، وCtrl+C مرتين بيطلع · Ctrl+R بيدوّر بالتاريخ\nأوامرك إنت: ملفات .md بـ .rafiq/commands بالمشروع (و$ARGUMENTS بتصير اللي بتكتبه بعد الأمر)",
        "ask": "بدّه إذن: {title}",
        "ask_title": "رفيق بدّه إذنك",
        "review": "رأي المراجع: {reason}",
        "choices": "[y] اسمح  [a] اسمح دايماً  [n] لا › ",
        "opt_yes": "اسمح",
        "opt_always": "اسمح دايماً لهالنوع",
        "opt_no": "لا، وقلّه شو يعمل بدالها",
        "allow_q": "تسمحله؟",
        "allowed": "سمحتله",
        "denied": "رفضت",
        "auto_allowed": "سمحله الوضع ({mode})",
        "plan_denied": "وضع الخطة: ما بيغيّر شي",
        "stopped": "وقّفت الرد.",
        "new": "محادثة جديدة.",
        "switched": "صار الموديل: {model}",
        "mode_now": "صار الوضع: {mode}",
        "no_model": "ما في موديل بهالاسم.",
        "pick_model": "اختار الموديل",
        "pick_mode": "اختار الوضع",
        "pick_chat": "كمّل محادثة",
        "no_chats": "ما في محادثات سابقة بهالمجلد.",
        "resumed": "رجعت للمحادثة: {title}",
        "you": "إنت",
        "rafiq": "رفيق",
        "compacted": "لخّصت {count} رسالة: من ~{before} لـ ~{after} توكن.",
        "nothing_to_compact": "لسا ما في محادثة لتتلخّص.",
        "cost": "اليوم: ${today:.2f} · هالشهر: ${month:.2f}",
        "budget": "الحد اليومي: ${daily:.2f} · الشهري: ${monthly:.2f}",
        "no_budget": "ما في حد للمصروف (من التطبيق: الإعدادات ← التكلفة).",
        "status": "الموديل: {model}\nالوضع: {mode}\nالمجلد: {folder}\nالوكيل: {agent}\nالمحادثة: {chat}",
        "init": "اقرأ هالمشروع (الملفات المهمة، طريقة التشغيل والاختبار، الأسلوب) واكتب ملف RAFIQ.md بجذر المجلد فيه تعليمات مختصرة لأي حدا بيشتغل عليه. إذا موجود، حدّثه.",
        "plan_prefix": "وضع الخطة: لا تغيّر ولا تشغّل شي. اقرأ اللي بدك ياه وارجعلي بخطة مرقّمة.\n\n",
        "memories": "اللي بيتذكّره رفيق:",
        "no_memories": "رفيق ما بيتذكّر شي لهلأ. اكتب # وبعدها شي بدك يتذكّره.",
        "remembered": "انحفظ بذاكرة رفيق.",
        "tasks": "المهام:",
        "no_tasks": "ما في مهام.",
        "mcp": "خوادم MCP:",
        "no_mcp": "ما في خوادم MCP. ضيفها من التطبيق: الإعدادات ← MCP.",
        "skills": "المهارات:",
        "on": "شغّال",
        "off": "مطفي",
        "shell_ran": "النتيجة رح تروح مع رسالتك الجاية.",
        "shell_context": "شغّلت هالأمر بالطرفية ونتيجته:\n",
        "bye": "مع السلامة.",
        "unknown": "أمر مش معروف. جرّب /help",
        "thinking": "رفيق عم يفكّر…",
        "starting": "عم يشغّل رفيق بالخلفية…",
        "mode_app": "مربوط بالتطبيق",
        "mode_own": "شغّال بدون التطبيق",
        "reconnected": "انقطع الاتصال، ورجعت اتصلت.",
        "placeholder": "شو بدك يعمل؟  (/ للأوامر)",
        "again": "اكبس Ctrl+C كمان مرة لتطلع.",
        "tips": "/help · /model · /resume · Shift+Tab للوضع",
        "mode_hint": "Shift+Tab",
        "mode_ask": "بيسأل قبل كل خطوة",
        "mode_edits": "بيعدّل الملفات بدون ما يسأل",
        "mode_plan": "خطة بس، ما بيغيّر شي",
        "mode_auto": "بدون ما يسأل أبداً",
        "name": "رفيق",
        "pick_lang": "اختار لغة الطرفية",
        "lang_now": "صارت اللغة: {lang}",
        "no_lang": "اللغات: ar · en · ru",
        "speed": "{tps} توكن/ث",
        "first_word": " · أول كلمة بعد {first} ث",
        "no_models_yet": "ما في موديل لسا. خلّينا نضيف واحد.",
        "context_title": "السياق",
        "context_line": "المحادثة واخدة ~{used} توكن من {window} ({pct}%)",
        "context_used": "المحادثة واخدة ~{used} توكن",
        "context_cost": "آخر رد: {tokens} توكن · ${cost:.4f}",
        "no_chat": "لسا ما في محادثة.",
        "exported": "انحفظت المحادثة بـ {path}",
        "doctor_title": "فحص",
        "d_agent": "الوكيل",
        "d_models": "الموديلات",
        "d_path": "الأمر rafiq",
        "d_arabic": "العربي بالطرفية",
        "d_data": "مجلد البيانات",
        "d_models_n": "{ok} شغّالين من {n}",
        "d_on_path": "موجود على PATH",
        "d_not_on_path": "مش على PATH",
        "d_bidi_ours": "رفيق بيرتّبه",
        "d_bidi_term": "الطرفية بترتّبه",
        "perms_title": "الصلاحيات",
        "pick_perm": "اختار شو بدك تغيّر",
        "pick_perm_mode": "{key}: شو بدك يصير؟",
        "perm_ask": "يسأل",
        "perm_auto": "بدون سؤال",
        "perm_deny": "ممنوع",
        "perm_set": "{key}: {mode}",
        "vim_on": "صار وضع vim شغّال.",
        "vim_off": "وضع vim مطفي.",
        "think_on": "رح يبيّن تفكير الموديل.",
        "think_off": "ما رح يبيّن التفكير.",
        "copied": "انسخ آخر رد.",
        "nothing_to_copy": "ما في رد لتنسخه.",
        "review_prompt": "راجع التغييرات اللي لسا ما انعملها commit بهالمشروع (git diff، وإذا ما في، آخر commit): الأخطاء، المخاطر، وشو ممكن يتحسّن. ما تغيّر شي، بس اكتب المراجعة.",
        "commit_prompt": "شوف التغييرات بهالمشروع (git status و git diff)، اكتب رسالة commit واضحة ومختصرة، واعمل commit. ما تعمل push.",
        "task_started": "بدأت مهمة بالخلفية: {title} (/tasks لتتابعها)",
        "task_usage": "اكتب شو بدك المهمة تعمل: /task …",
        "release_title": "شو الجديد",
        "release_fail": "ما قدرت أجيب الملاحظات.",
        "custom_cmd": "أمر من {file}",
        "bug_opened": "فتحت صفحة البلاغات بالمتصفح.",
        "thought": "فكّر",
        "update_hint": "لتحدّث رفيق: حدّث التطبيق، أو إذا منزّل الطرفية لحالها شغّل:",
        "screen_hint": "Esc للرجوع · الأسهم للتمرير",
        "status_title": "الحالة",
        "cost_title": "المصروف",
        "add_model_opt": "+ ضيف موديل",
        "pick_provider": "اختار المزوّد",
        "custom_provider": "متوافق مع OpenAI (عنوان خاص)",
        "base_url": "عنوان الخادم (Base URL)",
        "api_key": "مفتاح الـAPI (ما بيطلع عالشاشة)",
        "discovering": "عم يجيب الموديلات…",
        "filter_models": "في {count} موديل. اكتب جزء من الاسم لتفلترهم (أو Enter للكل)",
        "other_model": "اكتب اسم موديل تاني…",
        "model_id_ask": "اسم الموديل (model id)",
        "name_ask": "اسم يبيّن بالقائمة",
        "verifying": "عم يجرّب الموديل…",
        "added": "انضاف، وصار الموديل: {model}",
        "cancelled": "انلغى.",
        "always_allowed": "سمحله (دايماً بهالجلسة)",
    },
    "en": {
        "banner": "Rafiq · {model} · {folder}",
        "hint": "Type what you want, or /help for commands. Ctrl+C stops a reply.",
        "help_title": "Commands",
        "help_more": "! a command runs here and its output goes with your next message · # text is kept in Rafiq's memory · @ a file\nShift+Tab switches the mode · Ctrl+J or Alt+Enter for a new line · Esc or Ctrl+C stops a reply, Ctrl+C twice leaves · Ctrl+R searches history\nYour own commands: .md files in .rafiq/commands in the project ($ARGUMENTS becomes what you type after the command)",
        "ask": "Needs permission: {title}",
        "ask_title": "Rafiq needs your permission",
        "review": "Reviewer: {reason}",
        "choices": "[y] allow  [a] always  [n] deny › ",
        "opt_yes": "Allow",
        "opt_always": "Always allow this kind",
        "opt_no": "No, and tell it what to do instead",
        "allow_q": "Allow it?",
        "allowed": "allowed",
        "denied": "denied",
        "auto_allowed": "allowed by the mode ({mode})",
        "plan_denied": "Plan mode: it changes nothing",
        "stopped": "Stopped the reply.",
        "new": "New chat.",
        "switched": "Model: {model}",
        "mode_now": "Mode: {mode}",
        "no_model": "No model by that name.",
        "pick_model": "Choose the model",
        "pick_mode": "Choose the mode",
        "pick_chat": "Resume a chat",
        "no_chats": "No earlier chats in this folder.",
        "resumed": "Back in: {title}",
        "you": "You",
        "rafiq": "Rafiq",
        "compacted": "Summarised {count} messages: from ~{before} to ~{after} tokens.",
        "nothing_to_compact": "No chat to summarise yet.",
        "cost": "Today: ${today:.2f} · This month: ${month:.2f}",
        "budget": "Daily limit: ${daily:.2f} · Monthly: ${monthly:.2f}",
        "no_budget": "No spending limit (in the app: Settings → Cost).",
        "status": "Model: {model}\nMode: {mode}\nFolder: {folder}\nAgent: {agent}\nChat: {chat}",
        "init": "Read this project (the important files, how to run and test it, its style) and write a RAFIQ.md at the folder's root with short instructions for anyone working on it. If one exists, update it.",
        "plan_prefix": "Plan mode: don't change or run anything. Read what you need and come back with a numbered plan.\n\n",
        "memories": "What Rafiq remembers:",
        "no_memories": "Rafiq remembers nothing yet. Type # and something it should remember.",
        "remembered": "Kept in Rafiq's memory.",
        "tasks": "Tasks:",
        "no_tasks": "No tasks.",
        "mcp": "MCP servers:",
        "no_mcp": "No MCP servers. Add them in the app: Settings → MCP.",
        "skills": "Skills:",
        "on": "on",
        "off": "off",
        "shell_ran": "The output goes with your next message.",
        "shell_context": "I ran this command in the terminal; its output:\n",
        "bye": "Bye.",
        "unknown": "Unknown command. Try /help",
        "thinking": "Rafiq is thinking…",
        "starting": "Starting Rafiq in the background…",
        "mode_app": "with the app",
        "mode_own": "without the app",
        "reconnected": "The connection dropped; reconnected.",
        "placeholder": "What should it do?  (/ for commands)",
        "again": "Press Ctrl+C again to leave.",
        "tips": "/help · /model · /resume · Shift+Tab for the mode",
        "mode_hint": "Shift+Tab",
        "mode_ask": "asks before every step",
        "mode_edits": "edits files without asking",
        "mode_plan": "plan only, changes nothing",
        "mode_auto": "never asks",
        "name": "Rafiq",
        "pick_lang": "Choose the terminal's language",
        "lang_now": "Language: {lang}",
        "no_lang": "Languages: ar · en · ru",
        "speed": "{tps} tok/s",
        "first_word": " · first word after {first} s",
        "no_models_yet": "No model yet. Let's add one.",
        "context_title": "Context",
        "context_line": "This chat uses ~{used} of {window} tokens ({pct}%)",
        "context_used": "This chat uses ~{used} tokens",
        "context_cost": "Last reply: {tokens} tokens · ${cost:.4f}",
        "no_chat": "No chat yet.",
        "exported": "Saved the chat to {path}",
        "doctor_title": "Doctor",
        "d_agent": "Agent",
        "d_models": "Models",
        "d_path": "rafiq command",
        "d_arabic": "Arabic in this terminal",
        "d_data": "Data folder",
        "d_models_n": "{ok} of {n} working",
        "d_on_path": "on PATH",
        "d_not_on_path": "not on PATH",
        "d_bidi_ours": "Rafiq lays it out",
        "d_bidi_term": "the terminal lays it out",
        "perms_title": "Permissions",
        "pick_perm": "Choose what to change",
        "pick_perm_mode": "{key}: what should happen?",
        "perm_ask": "ask",
        "perm_auto": "allow",
        "perm_deny": "deny",
        "perm_set": "{key}: {mode}",
        "vim_on": "Vim mode on.",
        "vim_off": "Vim mode off.",
        "think_on": "Showing the model's thinking.",
        "think_off": "Hiding the thinking.",
        "copied": "Copied the last reply.",
        "nothing_to_copy": "No reply to copy.",
        "review_prompt": "Review the uncommitted changes in this project (git diff, or the last commit if there are none): bugs, risks and what could be better. Don't change anything; just write the review.",
        "commit_prompt": "Look at the changes in this project (git status and git diff), write a clear, short commit message and commit. Don't push.",
        "task_started": "Started a background task: {title} (/tasks to follow it)",
        "task_usage": "Say what the task should do: /task …",
        "release_title": "What's new",
        "release_fail": "Couldn't fetch the notes.",
        "custom_cmd": "command from {file}",
        "bug_opened": "Opened the issues page in your browser.",
        "thought": "Thought",
        "update_hint": "To update Rafiq: update the app, or if you installed the terminal on its own, run:",
        "screen_hint": "Esc to go back · ↑↓ to scroll",
        "status_title": "Status",
        "cost_title": "Spending",
        "add_model_opt": "+ Add a model",
        "pick_provider": "Choose the provider",
        "custom_provider": "OpenAI-compatible (your own URL)",
        "base_url": "Server address (base URL)",
        "api_key": "API key (hidden)",
        "discovering": "Fetching the models…",
        "filter_models": "{count} models. Type part of a name to filter (or Enter for all)",
        "other_model": "Type another model id…",
        "model_id_ask": "Model id",
        "name_ask": "Display name",
        "verifying": "Testing the model…",
        "added": "Added, and switched to: {model}",
        "cancelled": "Cancelled.",
        "always_allowed": "allowed (always, this session)",
    },
    "ru": {
        "banner": "Rafiq · {model} · {folder}",
        "hint": "Напишите, что нужно сделать, или /help для команд. Ctrl+C останавливает ответ.",
        "help_title": "Команды",
        "help_more": "! команда выполняется здесь, её вывод уйдёт со следующим сообщением · # текст сохраняется в памяти Rafiq · @ файл\nShift+Tab меняет режим · Ctrl+J или Alt+Enter — новая строка · Esc или Ctrl+C останавливает ответ, Ctrl+C дважды — выход · Ctrl+R — поиск по истории\nСвои команды: файлы .md в .rafiq/commands проекта ($ARGUMENTS — то, что вы напишете после команды)",
        "ask": "Нужно разрешение: {title}",
        "ask_title": "Rafiq просит разрешения",
        "review": "Проверяющий: {reason}",
        "choices": "[y] разрешить  [a] всегда  [n] запретить › ",
        "opt_yes": "Разрешить",
        "opt_always": "Всегда разрешать такое",
        "opt_no": "Нет, и сказать, что сделать вместо этого",
        "allow_q": "Разрешить?",
        "allowed": "разрешено",
        "denied": "запрещено",
        "auto_allowed": "разрешено режимом ({mode})",
        "plan_denied": "Режим плана: ничего не меняется",
        "stopped": "Ответ остановлен.",
        "new": "Новый чат.",
        "switched": "Модель: {model}",
        "mode_now": "Режим: {mode}",
        "no_model": "Нет модели с таким именем.",
        "pick_model": "Выберите модель",
        "pick_mode": "Выберите режим",
        "pick_chat": "Продолжить чат",
        "no_chats": "В этой папке ещё нет чатов.",
        "resumed": "Снова в чате: {title}",
        "you": "Вы",
        "rafiq": "Rafiq",
        "compacted": "Сжато сообщений: {count}, с ~{before} до ~{after} токенов.",
        "nothing_to_compact": "Пока нечего сжимать.",
        "cost": "Сегодня: ${today:.2f} · В этом месяце: ${month:.2f}",
        "budget": "Дневной лимит: ${daily:.2f} · Месячный: ${monthly:.2f}",
        "no_budget": "Лимита расходов нет (в приложении: Настройки → Стоимость).",
        "status": "Модель: {model}\nРежим: {mode}\nПапка: {folder}\nАгент: {agent}\nЧат: {chat}",
        "init": "Прочитай этот проект (важные файлы, как его запускать и тестировать, его стиль) и напиши в корне папки RAFIQ.md с краткими инструкциями для всех, кто с ним работает. Если файл уже есть, обнови его.",
        "plan_prefix": "Режим плана: ничего не меняй и не запускай. Прочитай, что нужно, и вернись с пронумерованным планом.\n\n",
        "memories": "Что помнит Rafiq:",
        "no_memories": "Rafiq пока ничего не помнит. Напишите # и то, что нужно запомнить.",
        "remembered": "Сохранено в памяти Rafiq.",
        "tasks": "Задачи:",
        "no_tasks": "Задач нет.",
        "mcp": "MCP-серверы:",
        "no_mcp": "MCP-серверов нет. Добавьте их в приложении: Настройки → MCP.",
        "skills": "Навыки:",
        "on": "вкл.",
        "off": "выкл.",
        "shell_ran": "Вывод уйдёт с вашим следующим сообщением.",
        "shell_context": "Я выполнил эту команду в терминале, её вывод:\n",
        "bye": "До встречи.",
        "unknown": "Неизвестная команда. Попробуйте /help",
        "thinking": "Rafiq думает…",
        "starting": "Rafiq запускается в фоне…",
        "mode_app": "через приложение",
        "mode_own": "без приложения",
        "reconnected": "Связь прервалась; подключился снова.",
        "placeholder": "Что сделать?  (/ — команды)",
        "again": "Нажмите Ctrl+C ещё раз, чтобы выйти.",
        "tips": "/help · /model · /resume · Shift+Tab — режим",
        "mode_hint": "Shift+Tab",
        "mode_ask": "спрашивает перед каждым шагом",
        "mode_edits": "правит файлы без вопросов",
        "mode_plan": "только план, ничего не меняет",
        "mode_auto": "никогда не спрашивает",
        "name": "Rafiq",
        "pick_lang": "Выберите язык терминала",
        "lang_now": "Язык: {lang}",
        "no_lang": "Языки: ar · en · ru",
        "speed": "{tps} ток/с",
        "first_word": " · первое слово через {first} с",
        "no_models_yet": "Моделей пока нет. Давайте добавим.",
        "context_title": "Контекст",
        "context_line": "Чат занимает ~{used} из {window} токенов ({pct}%)",
        "context_used": "Чат занимает ~{used} токенов",
        "context_cost": "Последний ответ: {tokens} токенов · ${cost:.4f}",
        "no_chat": "Чата пока нет.",
        "exported": "Чат сохранён в {path}",
        "doctor_title": "Диагностика",
        "d_agent": "Агент",
        "d_models": "Модели",
        "d_path": "Команда rafiq",
        "d_arabic": "Арабский в терминале",
        "d_data": "Папка данных",
        "d_models_n": "работают {ok} из {n}",
        "d_on_path": "в PATH",
        "d_not_on_path": "не в PATH",
        "d_bidi_ours": "раскладывает Rafiq",
        "d_bidi_term": "раскладывает терминал",
        "perms_title": "Разрешения",
        "pick_perm": "Выберите, что изменить",
        "pick_perm_mode": "{key}: что делать?",
        "perm_ask": "спрашивать",
        "perm_auto": "разрешать",
        "perm_deny": "запрещать",
        "perm_set": "{key}: {mode}",
        "vim_on": "Режим vim включён.",
        "vim_off": "Режим vim выключен.",
        "think_on": "Показываю размышления модели.",
        "think_off": "Скрываю размышления.",
        "copied": "Последний ответ скопирован.",
        "nothing_to_copy": "Нечего копировать.",
        "review_prompt": "Проверь незакоммиченные изменения в этом проекте (git diff, а если их нет — последний commit): ошибки, риски и что можно улучшить. Ничего не меняй, просто напиши обзор.",
        "commit_prompt": "Посмотри изменения в этом проекте (git status и git diff), напиши понятное короткое сообщение и сделай commit. Без push.",
        "task_started": "Фоновая задача запущена: {title} (/tasks — следить)",
        "task_usage": "Опишите задачу: /task …",
        "release_title": "Что нового",
        "release_fail": "Не удалось загрузить заметки.",
        "custom_cmd": "команда из {file}",
        "bug_opened": "Открыл страницу ошибок в браузере.",
        "thought": "Размышления",
        "update_hint": "Чтобы обновить Rafiq: обновите приложение, а если терминал установлен отдельно, выполните:",
        "screen_hint": "Esc — назад · ↑↓ — прокрутка",
        "status_title": "Статус",
        "cost_title": "Расходы",
        "add_model_opt": "+ Добавить модель",
        "pick_provider": "Выберите провайдера",
        "custom_provider": "Совместимый с OpenAI (свой адрес)",
        "base_url": "Адрес сервера (base URL)",
        "api_key": "API-ключ (не отображается)",
        "discovering": "Загружаю модели…",
        "filter_models": "Моделей: {count}. Введите часть имени для фильтра (или Enter — все)",
        "other_model": "Ввести другой ID…",
        "model_id_ask": "ID модели",
        "name_ask": "Отображаемое имя",
        "verifying": "Проверяю модель…",
        "added": "Добавлена и выбрана: {model}",
        "cancelled": "Отменено.",
        "always_allowed": "разрешено (всегда, в этой сессии)",
    },
}

LANGS = ("ar", "en", "ru")
# What /model add offers: (provider, label, needs a key, needs an address).
PROVIDERS = [
    ("openai", "OpenAI", True, False),
    ("anthropic", "Anthropic", True, False),
    ("gemini", "Google Gemini", True, False),
    ("deepseek", "DeepSeek", True, False),
    ("openrouter", "OpenRouter", True, False),
    ("groq", "Groq", True, False),
    ("mistral", "Mistral", True, False),
    ("xai", "xAI", True, False),
    ("ollama", "Ollama", False, False),
    ("custom", "", True, True),
]
MAX_LISTED = 25
ISSUES = "https://github.com/AhmadALSaffan/RAFIQ/issues/new"
RELEASES_API = "https://api.github.com/repos/AhmadALSaffan/RAFIQ/releases/latest"
INSTALL_PS = "irm https://rafiqagent.com/install.ps1 | iex"
INSTALL_SH = "curl -fsSL https://rafiqagent.com/install.sh | sh"


def custom_commands(folder: str) -> dict[str, tuple[str, str]]:
    """Commands the user wrote: .md files in <project>/.rafiq/commands and in Rafiq's own
    commands folder (the project's win). {name: (description, body)}; the description is a
    "description:" line at the top, or the first line."""
    from rafiq_agent.cli import data_dir

    found: dict[str, tuple[str, str]] = {}
    for base in (data_dir() / "commands", Path(folder) / ".rafiq" / "commands"):
        with contextlib.suppress(OSError):
            for file in sorted(base.glob("*.md")):
                with contextlib.suppress(OSError, UnicodeDecodeError):
                    text = file.read_text(encoding="utf-8").strip()
                    lines = text.splitlines()
                    about = ""
                    if lines and lines[0].lower().startswith("description:"):
                        about, text = lines[0].split(":", 1)[1].strip(), "\n".join(lines[1:]).strip()
                    elif lines:
                        about = lines[0].lstrip("# ").strip()[:80]
                    found[file.stem.lower()] = (about, text)
    return found
LANG_NAMES = {"ar": "العربية", "en": "English", "ru": "Русский"}
# Where the terminal keeps its own choices (the language), next to its history.
PREFS = "terminal.json"


def saved_lang() -> str | None:
    from rafiq_agent.cli import data_dir

    with contextlib.suppress(OSError, ValueError, AttributeError):
        lang = json.loads((data_dir() / PREFS).read_text(encoding="utf-8")).get("lang")
        if lang in LANGS:
            return lang
    return None


def save_lang(lang: str) -> None:
    from rafiq_agent.cli import data_dir

    path = data_dir() / PREFS
    prefs: dict[str, Any] = {}
    with contextlib.suppress(OSError, ValueError):
        prefs = json.loads(path.read_text(encoding="utf-8"))
    prefs["lang"] = lang
    with contextlib.suppress(OSError):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(prefs), encoding="utf-8")


def pick_lang(flag: str | None) -> str:
    """--lang, then RAFIQ_LANG, then the one chosen with /lang, then Arabic."""
    for lang in (flag, os.environ.get("RAFIQ_LANG"), saved_lang()):
        if lang and lang.lower()[:2] in LANGS:
            return lang.lower()[:2]
    return "ar"

# (command, {language: description}) — what /help shows and the / menu offers.
COMMAND_HELP: list[tuple[str, dict[str, str]]] = [
    ("/model", {"ar": "اختار الموديل، أو ضيف واحد", "en": "choose the model, or add one", "ru": "выбрать модель или добавить новую"}),
    ("/mode", {"ar": "يسأل، يعدّل لحاله، خطة بس، أو بدون ما يسأل", "en": "ask, accept edits, plan only, or never ask", "ru": "спрашивать, править сам, только план или не спрашивать"}),
    ("/lang", {"ar": "لغة الطرفية: عربي، English، Русский", "en": "the terminal's language: عربي, English, Русский", "ru": "язык терминала: عربي, English, Русский"}),
    ("/new", {"ar": "محادثة جديدة", "en": "a new chat", "ru": "новый чат"}),
    ("/clear", {"ar": "امسح الشاشة وابدأ محادثة جديدة", "en": "clear the screen and start a new chat", "ru": "очистить экран и начать новый чат"}),
    ("/resume", {"ar": "كمّل محادثة سابقة بهالمجلد", "en": "resume an earlier chat in this folder", "ru": "продолжить прошлый чат в этой папке"}),
    ("/compact", {"ar": "لخّص المحادثة لتوفّر توكنز", "en": "summarise the chat to save tokens", "ru": "сжать чат, чтобы сэкономить токены"}),
    ("/cost", {"ar": "مصروف اليوم والشهر", "en": "today's and this month's spending", "ru": "расходы за сегодня и за месяц"}),
    ("/context", {"ar": "قديش المحادثة واخدة من ذاكرة الموديل", "en": "how much of the model's window the chat uses", "ru": "сколько окна модели занимает чат"}),
    ("/export", {"ar": "احفظ المحادثة بملف Markdown", "en": "save the chat as a Markdown file", "ru": "сохранить чат в Markdown"}),
    ("/copy", {"ar": "انسخ آخر رد", "en": "copy the last reply", "ru": "скопировать последний ответ"}),
    ("/review", {"ar": "راجع التغييرات بالكود", "en": "review the code changes", "ru": "проверить изменения в коде"}),
    ("/commit", {"ar": "اكتب رسالة commit واعمل commit", "en": "write a commit message and commit", "ru": "написать сообщение и сделать commit"}),
    ("/task", {"ar": "شغّل مهمة بالخلفية", "en": "run a task in the background", "ru": "запустить фоновую задачу"}),
    ("/permissions", {"ar": "شو بيعمله لحاله وشو بيستأذن عليه", "en": "what runs on its own and what asks", "ru": "что выполняется само, а что спрашивает"}),
    ("/status", {"ar": "الموديل والوضع والمجلد والوكيل", "en": "model, mode, folder and agent", "ru": "модель, режим, папка и агент"}),
    ("/init", {"ar": "اكتب RAFIQ.md بتعليمات المشروع", "en": "write a RAFIQ.md with the project's instructions", "ru": "написать RAFIQ.md с инструкциями проекта"}),
    ("/memory", {"ar": "اللي بيتذكّره رفيق", "en": "what Rafiq remembers", "ru": "что помнит Rafiq"}),
    ("/tasks", {"ar": "مهام رفيق بالخلفية", "en": "Rafiq's background tasks", "ru": "фоновые задачи Rafiq"}),
    ("/mcp", {"ar": "خوادم MCP", "en": "MCP servers", "ru": "MCP-серверы"}),
    ("/skills", {"ar": "المهارات", "en": "skills", "ru": "навыки"}),
    ("/folder", {"ar": "المجلد اللي شغّال عليه", "en": "the folder it works in", "ru": "папка, в которой он работает"}),
    ("/doctor", {"ar": "افحص إذا كل شي شغّال", "en": "check that everything works", "ru": "проверить, что всё работает"}),
    ("/think", {"ar": "بيّن أو خبّي تفكير الموديل", "en": "show or hide the model's thinking", "ru": "показать или скрыть размышления"}),
    ("/vim", {"ar": "مفاتيح vim للكتابة", "en": "vim keys for typing", "ru": "клавиши vim для ввода"}),
    ("/release-notes", {"ar": "شو الجديد بآخر نسخة", "en": "what's new in the latest version", "ru": "что нового в последней версии"}),
    ("/bug", {"ar": "بلّغ عن مشكلة", "en": "report a problem", "ru": "сообщить о проблеме"}),
    ("/help", {"ar": "هالقائمة", "en": "this list", "ru": "этот список"}),
    ("/exit", {"ar": "طلوع", "en": "leave", "ru": "выйти"}),
]
COMMANDS = [c for c, _ in COMMAND_HELP]
CHOICES = {"1": "approved", "y": "approved", "yes": "approved", "ن": "approved",
           "2": "always", "a": "always",
           "3": "denied", "n": "denied", "no": "denied", "ل": "denied"}


# ── An agent for the terminal ──────────────────────────────────────────────────────────


class Agent:
    """The agent this session talks to: the app's, or one started here when there's none."""

    def __init__(self, lang: str) -> None:
        self.lang = lang
        self.process: subprocess.Popen | None = None

    @staticmethod
    def _alive(api: AgentApi) -> bool:
        try:
            with urllib.request.urlopen(api.base + "/health", timeout=3):  # noqa: S310 - localhost only
                return True
        except OSError:
            return False

    def connect(self, wait: Callable[[str], Any] | None = None) -> AgentApi:
        """The running agent, or a new one (started in the background) when none answers."""
        with contextlib.suppress(RuntimeError):
            api = AgentApi(self.lang)
            if self._alive(api):
                return api
        if self.process is not None and self.process.poll() is None:
            self.stop()
        if wait is not None:
            with wait(TEXTS.get(self.lang, TEXTS["en"])["starting"]):
                return self._start()
        return self._start()

    @property
    def owned(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def _start(self) -> AgentApi:
        from rafiq_agent.cli import DISCOVERY, data_dir

        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        env = {
            **os.environ,
            "RAFIQ_TOKEN": secrets.token_hex(32),
            "RAFIQ_OWNER": "terminal",
            "RAFIQ_PORT": str(port),
            # It ends with this terminal, even when the window is closed without /exit.
            "RAFIQ_PARENT_PID": str(os.getpid()),
        }
        if getattr(sys, "frozen", False):
            agent = Path(sys.executable).with_name("rafiq-agent.exe" if sys.platform == "win32" else "rafiq-agent")
            argv = [str(agent), "--port", str(port)]
        else:
            argv = [sys.executable, "-m", "uvicorn", "rafiq_agent.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"]
        kwargs: dict[str, Any] = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "env": env}
        if sys.platform == "win32":
            kwargs["creationflags"] = 0x08000000 | 0x00000200  # no window, own process group
        else:
            kwargs["start_new_session"] = True
        self.process = subprocess.Popen(argv, **kwargs)
        discovery = data_dir() / DISCOVERY
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Rafiq's agent didn't start. Open the Rafiq app once, then try again.")
            with contextlib.suppress(OSError, ValueError, KeyError):
                info = json.loads(discovery.read_text(encoding="utf-8"))
                if info.get("pid") == self.process.pid or info.get("port") == port:
                    api = AgentApi(self.lang)
                    if self._alive(api):
                        return api
            time.sleep(0.3)
        self.stop()
        raise RuntimeError("Rafiq's agent took too long to start.")

    def stop(self) -> None:
        """Stops the agent this session started (and what it started), if it's still ours."""
        if self.process is None:
            return
        from rafiq_agent.cli import DISCOVERY, data_dir

        pid = self.process.pid
        if self.process.poll() is None:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, creationflags=0x08000000)
            else:
                import signal

                with contextlib.suppress(ProcessLookupError, PermissionError):
                    os.killpg(pid, signal.SIGTERM)
            with contextlib.suppress(subprocess.TimeoutExpired):
                self.process.wait(10)
        discovery = data_dir() / DISCOVERY
        with contextlib.suppress(OSError, ValueError):
            if json.loads(discovery.read_text(encoding="utf-8")).get("pid") == pid:
                discovery.unlink()
        self.process = None


# ── The plain view (pipes, tests) ──────────────────────────────────────────────────────


class Style:
    """ANSI colours when the terminal shows them (and NO_COLOR isn't set)."""

    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled

    def _wrap(self, code: str, text: str) -> str:
        return f"\033[{code}m{text}\033[0m" if self.enabled else text

    def dim(self, text: str) -> str:
        return self._wrap("2", text)

    def bold(self, text: str) -> str:
        return self._wrap("1", text)

    def accent(self, text: str) -> str:
        return self._wrap("38;5;208", text)

    def ok(self, text: str) -> str:
        return self._wrap("32", text)

    def bad(self, text: str) -> str:
        return self._wrap("31", text)


def _enable_colors(out: IO[str]) -> bool:
    if os.environ.get("NO_COLOR") or not hasattr(out, "isatty") or not out.isatty():
        return False
    if sys.platform == "win32":
        import ctypes

        kernel = ctypes.windll.kernel32
        handle = kernel.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if not kernel.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        kernel.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
    return True


class Repl:
    """The chat loop and its commands. Output goes through the view methods (plain lines
    here; tui.RichRepl draws them)."""

    def __init__(
        self,
        api: Any,
        folder: str,
        out: IO[str],
        read: Callable[[str], str],
        lang: str = "ar",
        model: str | None = None,
        colors: bool = False,
        reconnect: Callable[[], Any] | None = None,
    ) -> None:
        self.api, self.folder, self.out, self.read = api, folder, out, read
        self.lang = lang
        self.text = TEXTS.get(lang, TEXTS["en"])
        self.style = Style(colors)
        self.reconnect = reconnect
        self.models = api.models()
        # No model yet (the terminal installed on its own): run() offers to add one.
        self.model = self._find(model) or (self.models[0] if self.models else {"id": "", "name": "—", "model_id": ""})
        self.chat_id: str | None = None
        self.mode = "ask"
        # Output of `!` commands, sent along with the next message.
        self.context: list[str] = []
        self.owned: Callable[[], bool] = lambda: False
        # Tools the user said "always" to: in ask mode they don't ask again this session.
        self.always: set[str] = set()
        self.show_thinking = False
        self.last_reply = ""
        self.usage: dict[str, Any] = {}
        # Run after the welcome: --continue / --resume, a prompt given on the command line.
        self.startup: list[Callable[[], None]] = []
        # Told when /lang switches (the agent starter, so a reconnect keeps the language).
        self.on_lang: Callable[[str], None] | None = None

    def mode_label(self, mode: str | None = None) -> str:
        return self.text[f"mode_{mode or self.mode}"]

    # ── View (plain) ─────────────────────────────────────────────────────────────────────

    def say(self, line: str = "", end: str = "\n") -> None:
        self.out.write(line + end)
        self.out.flush()

    def show_banner(self) -> None:
        self.say(self.style.accent(self.text["banner"].format(model=self.model["name"], folder=self.folder)))
        self.say(self.style.dim(self.text["hint"]))

    def info(self, text: str) -> None:
        self.say(self.style.dim(text))

    def error(self, text: str) -> None:
        self.say(self.style.bad(text))

    def heading(self, text: str) -> None:
        self.say(self.style.bold(text))

    def rows(self, rows: list[tuple[str, str]]) -> None:
        """A small list: a name and a note."""
        for name, note in rows:
            self.say(f"  {name}  {self.style.dim(note)}" if note else f"  {name}")

    def thinking(self, on: bool) -> None:
        """Shown while nothing is coming yet (plain: nothing)."""

    def text_delta(self, text: str) -> None:
        self.say(text, end="")
        self._mid_line = not text.endswith("\n")

    def text_end(self) -> None:
        if getattr(self, "_mid_line", False):
            self.say()
            self._mid_line = False

    def show_tool(self, name: str, args: dict[str, Any]) -> None:
        self.say(self.style.accent("● ") + tool_title(name, args))

    def show_result(self, ok: bool, output: str) -> None:
        lines = output.strip().splitlines()
        mark = self.style.ok("  ⎿ ") if ok else self.style.bad("  ⎿ ")
        for i, line in enumerate(lines[:MAX_RESULT_LINES] or [""]):
            self.say((mark if i == 0 else "    ") + self.style.dim(line[:160]))
        if len(lines) > MAX_RESULT_LINES:
            self.say(self.style.dim(f"    … +{len(lines) - MAX_RESULT_LINES}"))

    def show_message(self, role: str, text: str) -> None:
        """A message from an earlier part of a resumed chat."""
        who = self.text["you"] if role == "user" else self.text["rafiq"]
        self.say(self.style.bold(f"{who}: ") + text.strip()[:600])

    def show_models(self) -> None:
        for model in self.models:
            mark = "●" if model["id"] == self.model["id"] else " "
            self.say(f" {mark} {model['name']}  {self.style.dim(model['model_id'])}")

    def pick(self, title: str, options: list[tuple[str, str]], default: str | None = None) -> str | None:
        """One of `options` (value, label), or None. Plain: lists them; nothing is read."""
        self.heading(title)
        for value, label in options:
            self.say(f" {'●' if value == default else ' '} {label}")
        return None

    def ask_permission(self, call: dict[str, Any]) -> str:
        title = tool_title(call.get("tool", ""), call.get("args") or {})
        self.say(self.style.bold(self.text["ask"].format(title=title)))
        if call.get("review"):
            self.say(self.style.dim(self.text["review"].format(reason=call["review"])))
        for line in str(call.get("preview") or "").strip().splitlines()[:12]:
            color = self.style.ok if line.startswith("+") else self.style.bad if line.startswith("-") else self.style.dim
            self.say("  " + color(line[:160]))
        while True:
            try:
                answer = self.read(self.text["choices"]).strip().lower()
            except (EOFError, KeyboardInterrupt):
                return "denied"
            if answer in CHOICES:
                return CHOICES[answer]

    def screen(self, title: str, draw: Callable[[], None]) -> None:
        """A view of its own (status, cost, lists). Plain: printed in place."""
        self.heading(title)
        draw()

    def ask_text(self, label: str, secret: bool = False, default: str = "") -> str | None:
        """One answer typed in (None: cancelled). A secret isn't shown or kept in history."""
        try:
            answer = self.read(f"{label}: ").strip()
        except (EOFError, KeyboardInterrupt):
            return None
        return answer or default

    def busy(self, text: str) -> Any:
        """A spinner while something slow runs (plain: a line)."""
        self.info(text)
        return contextlib.nullcontext()

    def read_line(self) -> str:
        line = self.read("\n› ")
        # A line ending in \ goes on to the next one.
        while line.endswith("\\"):
            try:
                line = line[:-1] + "\n" + self.read("  ")
            except (EOFError, KeyboardInterrupt):
                break
        return line

    def clear(self) -> None:
        """Clears the screen (plain: nothing to clear)."""

    def mode_changed(self) -> None:
        self.info(self.text["mode_now"].format(mode=self.mode_label()))

    # ── Engine ───────────────────────────────────────────────────────────────────────────

    def _find(self, name: str | None) -> dict[str, Any] | None:
        if not name:
            return None
        wanted = name.lower()
        for model in self.models:
            if wanted in (model["name"].lower(), model["model_id"].lower(), model["id"].lower()):
                return model
        for model in self.models:
            if wanted in model["name"].lower() or wanted in model["model_id"].lower():
                return model
        return None

    def _get(self, path: str) -> Any:
        return self.api._request("GET", path)

    def cycle_mode(self) -> None:
        self.mode = MODES[(MODES.index(self.mode) + 1) % len(MODES)]

    def command(self, line: str) -> bool:
        """Runs a /command; False when it's time to leave."""
        name, _, rest = line[1:].partition(" ")
        name, rest = name.lower(), rest.strip()
        handler = {
            "exit": None, "quit": None, "q": None,
            "help": self.cmd_help, "new": self.cmd_new, "clear": self.cmd_clear, "model": self.cmd_model,
            "mode": self.cmd_mode, "resume": self.cmd_resume, "compact": self.cmd_compact, "cost": self.cmd_cost,
            "status": self.cmd_status, "init": self.cmd_init, "memory": self.cmd_memory, "tasks": self.cmd_tasks,
            "mcp": self.cmd_mcp, "skills": self.cmd_skills, "folder": self.cmd_folder,
            "lang": self.cmd_lang, "language": self.cmd_lang,
            "context": self.cmd_context, "export": self.cmd_export, "copy": self.cmd_copy,
            "review": self.cmd_review, "commit": self.cmd_commit, "task": self.cmd_task,
            "permissions": self.cmd_permissions, "doctor": self.cmd_doctor, "think": self.cmd_think,
            "vim": self.cmd_vim, "release-notes": self.cmd_release_notes, "bug": self.cmd_bug,
        }
        if name not in handler:
            custom = custom_commands(self.folder).get(name)
            if custom is None:
                self.error(self.text["unknown"])
                return True
            body = custom[1]
            self._send_or_reconnect(body.replace("$ARGUMENTS", rest) if "$ARGUMENTS" in body else (body + ("\n\n" + rest if rest else "")))
            return True
        if handler[name] is None:
            return False
        try:
            handler[name](rest)
        except RuntimeError as exc:
            self.error(str(exc))
        return True

    def cmd_help(self, _rest: str) -> None:
        def draw() -> None:
            self.rows([(c, self.describe(about)) for c, about in COMMAND_HELP])
            self.say()
            self.info(self.text["help_more"])

        self.screen(self.text["help_title"], draw)

    def describe(self, about: dict[str, str]) -> str:
        return about.get(self.lang) or about["en"]

    def set_lang(self, lang: str) -> None:
        """Switches every text here (and the agent's messages) to `lang`, and keeps it."""
        self.lang = lang
        self.text = TEXTS[lang]
        with contextlib.suppress(AttributeError):
            self.api.lang = lang
        if self.on_lang is not None:
            self.on_lang(lang)
        save_lang(lang)

    def cmd_lang(self, rest: str) -> None:
        wanted = rest.lower()[:2]
        if rest and wanted not in LANGS:
            self.error(self.text["no_lang"])
            return
        if not rest:
            chosen = self.pick(self.text["pick_lang"], [(code, LANG_NAMES[code]) for code in LANGS], self.lang)
            if chosen is None:
                return
            wanted = chosen
        self.set_lang(wanted)
        self.lang_changed()

    def lang_changed(self) -> None:
        self.info(self.text["lang_now"].format(lang=LANG_NAMES[self.lang]))

    def markdown(self, text: str) -> None:
        """Text written in Markdown (release notes). Plain: as it is."""
        self.say(text)

    def reasoning(self, text: str) -> None:
        """The model's thinking for one step, when /think is on (plain: dim lines)."""
        for line in text.strip().splitlines()[-8:]:
            self.info(f"  {line}")

    def cmd_context(self, _rest: str) -> None:
        usage = self.usage
        if not usage.get("context_tokens"):
            self.info(self.text["no_chat"])
            return
        used, window = usage["context_tokens"], usage.get("context_window")

        def draw() -> None:
            if window:
                self.say(self.text["context_line"].format(used=f"{used:,}", window=f"{window:,}", pct=round(100 * used / window)))
                filled = round(30 * used / window)
                self.say("█" * filled + "░" * (30 - filled))
            else:
                self.say(self.text["context_used"].format(used=f"{used:,}"))
            tokens = (usage.get("prompt_tokens") or 0) + (usage.get("completion_tokens") or 0)
            self.info(self.text["context_cost"].format(tokens=f"{tokens:,}", cost=usage.get("cost_usd") or 0))

        self.screen(self.text["context_title"], draw)

    def cmd_export(self, rest: str) -> None:
        if not self.chat_id:
            self.info(self.text["no_chat"])
            return
        chat = self._get(f"/chats/{self.chat_id}")
        lines = [f"# {chat.get('title') or 'Rafiq'}", ""]
        for message in chat.get("messages") or []:
            if not message.get("content"):
                continue
            who = self.text["you"] if message.get("role") == "user" else self.text["rafiq"]
            lines += [f"**{who}:**", "", str(message["content"]).strip(), ""]
        name = rest or f"rafiq-chat-{time.strftime('%Y%m%d-%H%M')}.md"
        path = Path(self.folder) / name if not Path(name).is_absolute() else Path(name)
        path.write_text("\n".join(lines), encoding="utf-8")
        self.info(self.text["exported"].format(path=path))

    def cmd_copy(self, _rest: str) -> None:
        if not self.last_reply.strip():
            self.info(self.text["nothing_to_copy"])
            return
        copy_to_clipboard(self.last_reply.strip())
        self.info(self.text["copied"])

    def cmd_review(self, _rest: str) -> None:
        self._send_or_reconnect(self.text["review_prompt"])

    def cmd_commit(self, rest: str) -> None:
        self._send_or_reconnect(self.text["commit_prompt"] + (f"\n\n{rest}" if rest else ""))

    def cmd_task(self, rest: str) -> None:
        if not rest:
            self.info(self.text["task_usage"])
            return
        task = self.api._request("POST", "/tasks", {"title": "", "prompt": rest, "model_id": self.model["id"], "working_dir": self.folder, "mode": "auto"})
        self.info(self.text["task_started"].format(title=(task or {}).get("title") or rest[:60]))

    def cmd_permissions(self, _rest: str) -> None:
        settings = self._get("/settings")
        permissions: dict[str, str] = dict(settings.get("permissions") or {})
        label = {"ask": self.text["perm_ask"], "auto": self.text["perm_auto"], "deny": self.text["perm_deny"]}
        key = self.pick(self.text["pick_perm"], [(k, f"{k}  ·  {label.get(v, v)}") for k, v in sorted(permissions.items())])
        if key is None:
            return
        mode = self.pick(self.text["pick_perm_mode"].format(key=key), [(m, label[m]) for m in ("ask", "auto", "deny")], permissions.get(key))
        if mode is None:
            return
        settings["permissions"] = {**permissions, key: mode}
        self.api._request("PUT", "/settings", settings)
        self.info(self.text["perm_set"].format(key=key, mode=label[mode]))

    def cmd_doctor(self, _rest: str) -> None:
        import shutil

        from rafiq_agent import rtl
        from rafiq_agent.cli import data_dir

        version = ""
        with contextlib.suppress(Exception):
            version = str(self._get("/diagnostics").get("version") or "")
        models = []
        with contextlib.suppress(Exception):
            models = self._get("/models") or []
        working = sum(1 for m in models if m.get("verify_ok") is not False)
        rows = [
            (self.text["d_agent"], f"{self.text['on']} {version}".strip()),
            (self.text["d_models"], self.text["d_models_n"].format(ok=working, n=len(models))),
            (self.text["d_path"], self.text["d_on_path"] if shutil.which("rafiq") else self.text["d_not_on_path"]),
            (self.text["d_arabic"], self.text["d_bidi_ours"] if rtl.enabled() else self.text["d_bidi_term"]),
            (self.text["d_data"], str(data_dir())),
        ]
        self.screen(self.text["doctor_title"], lambda: self.rows(rows))

    def cmd_think(self, _rest: str) -> None:
        self.show_thinking = not self.show_thinking
        self.info(self.text["think_on"] if self.show_thinking else self.text["think_off"])

    def cmd_vim(self, _rest: str) -> None:
        self.info(self.text["vim_off"])

    def cmd_release_notes(self, _rest: str) -> None:
        try:
            request = urllib.request.Request(RELEASES_API, headers={"Accept": "application/vnd.github+json", "User-Agent": "rafiq-terminal"})
            with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310 - a fixed https URL
                release = json.loads(response.read())
        except (OSError, ValueError):
            self.error(self.text["release_fail"])
            return
        self.screen(f"{self.text['release_title']} · {release.get('name') or release.get('tag_name')}", lambda: self.markdown(str(release.get("body") or "")))

    def cmd_bug(self, _rest: str) -> None:
        import webbrowser

        webbrowser.open(ISSUES)
        self.info(self.text["bug_opened"])

    def resume_latest(self) -> None:
        """--continue: the last chat in this folder, with its last messages."""
        chats = self._chats_here()
        if not chats:
            self.info(self.text["no_chats"])
            return
        self._open_chat(chats[0]["id"])

    def _chats_here(self) -> list[dict[str, Any]]:
        here = os.path.normcase(os.path.abspath(self.folder))
        chats = [
            c for c in self._get("/chats")
            if c.get("working_dir") and os.path.normcase(os.path.abspath(c["working_dir"])) == here and c.get("message_count")
        ]
        chats.sort(key=lambda c: c.get("updated_at") or "", reverse=True)
        return chats

    def _open_chat(self, chat_id: str) -> None:
        chat = self._get(f"/chats/{chat_id}")
        self.chat_id = chat_id
        self.info(self.text["resumed"].format(title=chat.get("title", "")))
        for message in (chat.get("messages") or [])[-6:]:
            if message.get("content"):
                self.show_message(message.get("role", ""), message["content"])

    def warm(self) -> None:
        """Has a local model read this chat ahead in the background, so its reply starts at
        once (agent core/warm.py). Nothing for a cloud model."""
        if self.model.get("provider") not in ("ollama", "lm_studio") or not hasattr(self.api, "_request"):
            return
        import threading

        body = {"model_id": self.model["id"], "chat_id": self.chat_id, "working_dir": self.folder}

        def send() -> None:
            with contextlib.suppress(Exception):
                self.api._request("POST", "/chats/warm", body)

        threading.Thread(target=send, daemon=True).start()

    def cmd_new(self, _rest: str) -> None:
        self.chat_id = None
        self.info(self.text["new"])

    def cmd_clear(self, _rest: str) -> None:
        self.chat_id = None
        self.clear()
        self.show_banner()

    def cmd_model(self, rest: str) -> None:
        if rest.lower() in ("add", "new", "+"):
            self.add_model()
            return
        if rest:
            found = self._find(rest)
            if not found:
                self.error(self.text["no_model"])
                return
        else:
            options = [(m["id"], f"{m['name']}  ({m['model_id']})") for m in self.models]
            options.append(("+add", self.text["add_model_opt"]))
            chosen = self.pick(self.text["pick_model"], options, self.model["id"])
            if chosen == "+add":
                self.add_model()
                return
            found = next((m for m in self.models if m["id"] == chosen), None)
            if found is None:
                return
        self.model = found
        self.info(self.text["switched"].format(model=found["name"]))
        self.warm()

    def add_model(self) -> None:
        """Adds a model the way the app does: provider, key, pick from what it offers, test."""
        labels = [(code, label or self.text["custom_provider"]) for code, label, _, _ in PROVIDERS]
        provider = self.pick(self.text["pick_provider"], labels)
        if provider is None:
            self.info(self.text["cancelled"])
            return
        _, label, needs_key, needs_url = next(p for p in PROVIDERS if p[0] == provider)
        base_url = None
        if needs_url:
            base_url = self.ask_text(self.text["base_url"])
            if not base_url:
                self.info(self.text["cancelled"])
                return
        api_key = None
        if needs_key:
            api_key = self.ask_text(self.text["api_key"], secret=True)
            if not api_key:
                self.info(self.text["cancelled"])
                return
        found: list[dict[str, Any]] = []
        with contextlib.suppress(RuntimeError), self.busy(self.text["discovering"]):
            found = self.api._request("POST", "/models/discover", {"provider": provider, "api_key": api_key, "base_url": base_url}) or []
        if len(found) > MAX_LISTED:
            wanted = (self.ask_text(self.text["filter_models"].format(count=len(found))) or "").lower()
            if wanted:
                found = [m for m in found if wanted in m["id"].lower() or wanted in (m.get("display_name") or "").lower()]
        options = [(m["id"], f"{m.get('display_name') or m['id']}  ({m['id']})" if m.get("display_name") and m["display_name"] != m["id"] else m["id"]) for m in found[:MAX_LISTED]]
        model_id: str | None = None
        if options:
            options.append(("+other", self.text["other_model"]))
            model_id = self.pick(self.text["pick_model"], options)
            if model_id is None:
                self.info(self.text["cancelled"])
                return
        if not options or model_id == "+other":
            model_id = self.ask_text(self.text["model_id_ask"])
            if not model_id:
                self.info(self.text["cancelled"])
                return
        shown = next((m.get("display_name") for m in found if m["id"] == model_id), None) or model_id
        name = self.ask_text(f"{self.text['name_ask']} [{shown}]", default=shown) or shown
        body = {"name": name, "provider": provider, "model_id": model_id, "base_url": base_url, "api_key": api_key}
        with self.busy(self.text["verifying"]):
            created = self.api._request("POST", "/models", body)
        self.models = self.api.models()
        self.model = next((m for m in self.models if m["id"] == created.get("id")), None) or self.model
        self.info(self.text["added"].format(model=created.get("name", name)))

    def cmd_mode(self, rest: str) -> None:
        if rest in MODES:
            self.mode = rest
        else:
            chosen = self.pick(self.text["pick_mode"], [(m, self.mode_label(m)) for m in MODES], self.mode)
            if chosen is None:
                return
            self.mode = chosen
        self.mode_changed()

    def cmd_resume(self, _rest: str) -> None:
        chats = self._chats_here()
        if not chats:
            self.info(self.text["no_chats"])
            return
        options = [(c["id"], f"{c['title']}  ·  {str(c.get('updated_at', ''))[:16].replace('T', ' ')}") for c in chats[:15]]
        chosen = self.pick(self.text["pick_chat"], options)
        if chosen is None:
            return
        self._open_chat(chosen)

    def cmd_compact(self, _rest: str) -> None:
        if not self.chat_id:
            self.info(self.text["nothing_to_compact"])
            return
        result = self.api._request("POST", f"/chats/{self.chat_id}/summarize", {"model_id": self.model["id"]})
        self.info(self.text["compacted"].format(
            count=result.get("folded_messages", 0),
            before=result.get("approx_tokens_before", 0),
            after=result.get("approx_tokens_after", 0),
        ))

    def cmd_cost(self, _rest: str) -> None:
        usage = self._get("/usage?days=30")

        def draw() -> None:
            self.say(self.text["cost"].format(today=usage.get("today_usd", 0), month=usage.get("month_usd", 0)))
            daily, monthly = usage.get("daily_budget_usd", 0), usage.get("monthly_budget_usd", 0)
            if daily or monthly:
                self.info(self.text["budget"].format(daily=daily, monthly=monthly))
            else:
                self.info(self.text["no_budget"])

        self.screen(self.text["cost_title"], draw)

    def cmd_status(self, _rest: str) -> None:
        values = [
            f"{self.model['name']} ({self.model['model_id']})",
            self.mode_label(),
            self.folder,
            self.text["mode_own"] if self.owned() else self.text["mode_app"],
            self.chat_id or "—",
        ]
        names = [line.split(":")[0] for line in self.text["status"].split("\n")]
        self.screen(self.text["status_title"], lambda: self.rows(list(zip(names, values, strict=True))))

    def cmd_init(self, _rest: str) -> None:
        self._send_or_reconnect(self.text["init"])

    def cmd_memory(self, _rest: str) -> None:
        memories = [m for m in self._get("/memories") if m.get("enabled", True)]
        if not memories:
            self.info(self.text["no_memories"])
            return
        self.screen(self.text["memories"].rstrip(":"), lambda: self.rows([(f"• {m['text']}", "") for m in memories[:200]]))

    def cmd_tasks(self, _rest: str) -> None:
        tasks = self._get("/tasks")[:100]
        if not tasks:
            self.info(self.text["no_tasks"])
            return
        self.screen(self.text["tasks"].rstrip(":"), lambda: self.rows([(t["title"], t.get("status", "")) for t in tasks]))

    def cmd_mcp(self, _rest: str) -> None:
        servers = self._get("/mcp")
        if not servers:
            self.info(self.text["no_mcp"])
            return
        self.screen(self.text["mcp"].rstrip(":"), lambda: self.rows([(s["name"], self.text["on"] if s.get("enabled") else self.text["off"]) for s in servers]))

    def cmd_skills(self, _rest: str) -> None:
        skills = self._get("/skills")
        self.screen(self.text["skills"].rstrip(":"), lambda: self.rows([(s["name"], (s.get("description") or "")[:90]) for s in skills[:200]]))

    def cmd_folder(self, _rest: str) -> None:
        self.say(self.folder)

    def remember(self, text: str) -> None:
        self.api._request("POST", "/memories", {"text": text})
        self.info(self.text["remembered"])

    def shell(self, command: str) -> None:
        """`!command`: runs here, in the folder; the output goes with the next message."""
        try:
            done = subprocess.run(command, shell=True, cwd=self.folder, capture_output=True, timeout=180)
            output = (done.stdout + done.stderr).decode("utf-8", errors="replace").strip()
            ok = done.returncode == 0
        except subprocess.TimeoutExpired:
            output, ok = "timed out after 180s", False
        self.show_tool("!", {"command": command})
        lines = output.splitlines()
        self.show_result(ok, "\n".join(lines[:MAX_SHELL_LINES]) + (f"\n… +{len(lines) - MAX_SHELL_LINES}" if len(lines) > MAX_SHELL_LINES else ""))
        self.context.append(f"$ {command}\n{output[-6000:]}")
        self.info(self.text["shell_ran"])

    def _permission(self, event: dict[str, Any]) -> str:
        """The answer to a permission request: from the mode, or from the user."""
        call = event.get("call") or {}
        tool = call.get("tool", "")
        if self.mode == "auto" or (self.mode == "edits" and tool in EDIT_TOOLS):
            self.info(self.text["auto_allowed"].format(mode=self.mode_label()))
            return "approved"
        if self.mode == "plan":
            self.info(self.text["plan_denied"])
            return "denied"
        if tool in self.always:
            self.info(self.text["always_allowed"])
            return "approved"
        choice = self.ask_permission(call)
        if choice == "always":
            self.always.add(tool)
        self.info(self.text["allowed"] if choice != "denied" else self.text["denied"])
        return choice

    def send(self, message: str) -> None:
        """One message and its reply. Raises RuntimeError when the agent can't be reached
        before anything came back (the caller may reconnect and try again)."""
        if self.chat_id is None:
            self.chat_id = self.api.create_chat(self.folder, self.model["id"])
        if self.context:
            message = self.text["shell_context"] + "\n\n".join(f"```\n{c}\n```" for c in self.context) + "\n\n" + message
            self.context = []
        if self.mode == "plan":
            message = self.text["plan_prefix"] + message
        self.thinking(True)
        self.last_reply = ""
        self.timed = False  # this reply reported its usage (and so its speed)
        thought = ""
        try:
            for event in self.api.send(self.chat_id, message, self.model["id"], ask_every_step=self.mode == "ask"):
                kind = event.get("type")
                if kind == "reasoning":
                    thought += str(event.get("text") or event.get("delta") or "")
                    continue
                if thought and self.show_thinking:
                    self.thinking(False)
                    self.reasoning(thought)
                thought = ""
                if kind == "delta":
                    self.thinking(False)
                    self.last_reply += event.get("text", "")
                    self.text_delta(event.get("text", ""))
                    continue
                if kind == "usage":
                    self.usage = event
                    self.timed = True
                    continue
                if kind == "notice":
                    self.info(str((event.get("part") or {}).get("text") or ""))
                    continue
                self.text_end()
                if kind == "tool_call":
                    self.thinking(False)
                    self.show_tool(event.get("tool", ""), event.get("args") or {})
                elif kind == "tool_result":
                    self.show_result(bool(event.get("ok")), str(event.get("output", "")))
                    self.thinking(True)
                elif kind == "permission":
                    self.thinking(False)
                    self.api.resolve(self.chat_id, event.get("id", ""), self._permission(event))
                    self.thinking(True)
                elif kind == "error":
                    self.thinking(False)
                    self.error(str(event.get("message") or event.get("detail") or "error"))
                elif kind == "stopped":
                    self.thinking(False)
                    self.info(self.text["stopped"])
                    break
                elif kind == "done":
                    break
        except KeyboardInterrupt:
            self.thinking(False)
            self.text_end()
            self.api.stop(self.chat_id)
            self.info(self.text["stopped"])
            return
        finally:
            self.thinking(False)
        self.text_end()
        self.show_speed()

    def show_speed(self) -> None:
        """How fast the model wrote this reply, and how long it took to start."""
        tps = self.usage.get("tokens_per_second") if getattr(self, "timed", False) else None
        if not tps:
            return
        line = self.text["speed"].format(tps=f"{tps:g}")
        first = self.usage.get("first_token_seconds")
        if first is not None and first >= 0.1:
            line += self.text["first_word"].format(first=f"{first:.1f}")
        self.info(line)

    def _send_or_reconnect(self, line: str) -> None:
        try:
            self.send(line)
        except RuntimeError as exc:
            if self.reconnect is None or "reachable" not in str(exc):
                self.error(str(exc))
                return
            # The app opened (its agent took over) or closed (ours stopped): find the agent
            # again and send once more. The chat is in the same data, so it carries on.
            try:
                self.api = self.reconnect()
                with contextlib.suppress(AttributeError):
                    self.api.lang = self.lang
                self.info(self.text["reconnected"])
                self.send(line)
            except RuntimeError as again:
                self.error(str(again))

    def handle(self, line: str) -> bool:
        """One line from the prompt; False when it's time to leave."""
        line = line.strip()
        if not line:
            return True
        if line.startswith("/"):
            return self.command(line)
        if line.startswith("!") and line[1:].strip():
            self.shell(line[1:].strip())
            return True
        if line.startswith("#") and line[1:].strip():
            try:
                self.remember(line[1:].strip())
            except RuntimeError as exc:
                self.error(str(exc))
            return True
        self._send_or_reconnect(line)
        return True

    def run(self) -> None:
        self.show_banner()
        if not self.models:
            self.info(self.text["no_models_yet"])
            try:
                self.add_model()
            except RuntimeError as exc:
                self.error(str(exc))
            if not self.models:
                return
        for step in self.startup:
            try:
                step()
            except RuntimeError as exc:
                self.error(str(exc))
        self.warm()
        while True:
            try:
                line = self.read_line()
            except (EOFError, KeyboardInterrupt):
                self.say()
                break
            if not self.handle(line):
                break
        self.info(self.text["bye"])



def copy_to_clipboard(text: str) -> None:
    if sys.platform == "win32":
        script = "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"
        subprocess.run(["powershell", "-NoProfile", "-Command", script], input=text.encode("utf-8"), capture_output=True, creationflags=0x08000000, check=False)
    elif sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=False)
    else:
        for tool in (["wl-copy"], ["xclip", "-selection", "clipboard"]):
            with contextlib.suppress(OSError):
                subprocess.run(tool, input=text.encode("utf-8"), check=False)
                return


def run_print(api: Any, prompt: str, folder: str, model: str | None, yes: bool, output: str, out: IO[str], err: IO[str]) -> int:
    """`rafiq -p "…"`: one message, the reply on stdout, nothing asked. A step that needs
    permission is refused unless --yes. Returns the exit code."""
    models = api.models()
    if not models:
        err.write("No working model in Rafiq. Run `rafiq` once to add one.\n")
        return 1
    wanted = (model or "").lower()
    chosen = next((m for m in models if wanted and wanted in (m["name"].lower(), m["model_id"].lower(), m["id"].lower())), None)
    chosen = chosen or next((m for m in models if wanted and (wanted in m["name"].lower() or wanted in m["model_id"].lower())), models[0])
    chat_id = api.create_chat(folder, chosen["id"])
    text, failed = "", False
    show_steps = hasattr(err, "isatty") and err.isatty()
    for event in api.send(chat_id, prompt, chosen["id"]):
        kind = event.get("type")
        if kind == "delta":
            text += event.get("text", "")
            if output == "text":
                out.write(event.get("text", ""))
                out.flush()
        elif kind == "tool_call" and show_steps:
            err.write(f"● {tool_title(event.get('tool', ''), event.get('args') or {})}\n")
        elif kind == "permission":
            call = event.get("call") or {}
            api.resolve(chat_id, event.get("id", ""), "approved" if yes else "denied")
            if not yes:
                err.write(f"refused (use --yes to allow): {tool_title(call.get('tool', ''), call.get('args') or {})}\n")
        elif kind == "error":
            failed = True
            err.write(str(event.get("message") or event.get("detail") or "error") + "\n")
        elif kind in ("done", "stopped"):
            break
    if output == "json":
        out.write(json.dumps({"result": text, "chat_id": chat_id, "model": chosen["name"], "is_error": failed}, ensure_ascii=False) + "\n")
    elif not text.endswith("\n"):
        out.write("\n")
    out.flush()
    return 1 if failed else 0


def _version(api: AgentApi) -> str:
    with contextlib.suppress(Exception):
        return str(api._request("GET", "/diagnostics").get("version") or "")
    return ""


def _option(argv: list[str], *names: str) -> str | None:
    for i, arg in enumerate(argv):
        if arg in names and i + 1 < len(argv):
            return argv[i + 1]
        for name in names:
            if name.startswith("--") and arg.startswith(name + "="):
                return arg.split("=", 1)[1]
    return None


FLAGS_WITH_VALUE = ("--model", "-m", "--lang", "-l", "--output-format")
FLAGS = ("-p", "--print", "-c", "--continue", "-r", "--resume", "--yes", "-y")


def _prompt_words(argv: list[str]) -> str:
    """What's left on the command line once the flags are taken out: an opening prompt."""
    words, skip = [], False
    for arg in argv:
        if skip:
            skip = False
            continue
        if arg in FLAGS_WITH_VALUE:
            skip = True
            continue
        if arg in FLAGS or arg.split("=")[0] in FLAGS_WITH_VALUE:
            continue
        words.append(arg)
    return " ".join(words).strip()


def main(argv: list[str]) -> None:
    model = _option(argv, "--model", "-m") or os.environ.get("RAFIQ_MODEL")
    lang = pick_lang(_option(argv, "--lang", "-l"))
    opening = _prompt_words(argv)
    if "-p" in argv or "--print" in argv:
        for stream in (sys.stdin, sys.stdout, sys.stderr):
            with contextlib.suppress(AttributeError, ValueError):
                stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        piped = "" if sys.stdin.isatty() else sys.stdin.read()
        prompt = opening if not piped else (f"{opening}\n\n```\n{piped.strip()}\n```" if opening else piped)
        if not prompt.strip():
            sys.exit('Usage: rafiq -p "what to do"   (or pipe text in: cat file | rafiq -p "explain")')
        agent = Agent(lang)
        try:
            api = agent.connect()
            code = run_print(api, prompt, os.getcwd(), model, "--yes" in argv or "-y" in argv, _option(argv, "--output-format") or "text", sys.stdout, sys.stderr)
        except RuntimeError as exc:
            sys.exit(str(exc))
        finally:
            agent.stop()
        sys.exit(code)
    # UTF-8 both ways: piped input on Windows would otherwise be read in the ANSI code page and
    # Arabic would arrive broken (a real console is read through its own Unicode API anyway).
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        with contextlib.suppress(AttributeError, ValueError):
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    interactive = sys.stdin.isatty() and sys.stdout.isatty() and not os.environ.get("RAFIQ_PLAIN")
    rich_ok = False
    if interactive:
        try:
            import prompt_toolkit  # noqa: F401
            import rich  # noqa: F401

            rich_ok = True
        except ImportError:
            pass
    agent = Agent(lang)
    try:
        if rich_ok:
            from rich.console import Console

            from rafiq_agent import rtl
            from rafiq_agent.tui import RichRepl

            def starting(text: str) -> Any:
                shown = rtl.visual(text) if rtl.enabled() else text
                return Console().status(f"[{ORANGE}]✻[/] {shown}", spinner="dots", spinner_style=ORANGE)

            api = agent.connect(starting)
            repl: Repl = RichRepl(api, os.getcwd(), sys.stdout, input, lang, model, True, reconnect=agent.connect, version=_version(api))
        else:
            if sys.platform != "win32":
                with contextlib.suppress(ImportError):
                    import readline  # noqa: F401 - line editing and history at the prompt
            api = agent.connect()
            repl = Repl(api, os.getcwd(), sys.stdout, input, lang, model, _enable_colors(sys.stdout), reconnect=agent.connect)
        repl.owned = lambda: agent.owned
        repl.on_lang = lambda code: setattr(agent, "lang", code)
        if "-c" in argv or "--continue" in argv:
            repl.startup.append(repl.resume_latest)
        elif "-r" in argv or "--resume" in argv:
            repl.startup.append(lambda: repl.cmd_resume(""))
        if opening:
            repl.startup.append(lambda: (repl._echo(opening) if hasattr(repl, "_echo") else repl.say(f"› {opening}"), repl._send_or_reconnect(opening)))
        repl.run()
    except RuntimeError as exc:
        sys.exit(str(exc))
    finally:
        agent.stop()
