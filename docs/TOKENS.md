# Where the tokens go, and what Rafiq does about it

Every request carries three things: what Rafiq **tells** the model (the system prompt), what
tools it **describes** to it (their JSON schemas), and the **conversation** itself. The first
two are paid on every single message, whether or not they get used — that is where the waste
lives, and that is what this page is about.

## Measured

Characters sent before the user's message, on a chat with no folder:

| | Prompt notes | Tool schemas | Total |
|---|---:|---:|---:|
| Default (saving off) | 6,997 | 6,573 | **13,570** |
| "Save tokens" on | 1,586 | 6,573 | **8,159** |
| …and browser + MCP off | 1,494 | 4,782 | **6,276** |
| Economy mode | 160 | 0 | **160** |

Roughly 3.5 characters to the token for this mix of Arabic and JSON: turning the saver on
takes a chat from about 3,900 tokens of overhead per message to about 2,300, dropping the
two heavy tool groups takes it under 1,800, and a question asked in economy mode costs
under 50. A chat with a folder pays more than all of these, because it also gets the file
and shell tools.

## What changed

**The skills index can be a list of names — and that is a switch.** The prompt describes
every bundled skill: 5,831 characters on every message, in a chat that may never touch one.
Turning **"save tokens"** on replaces that with the names, and the descriptions move behind
the `skill_list` tool, which the model calls whenever it wants them — that one switch is
the whole gap between the first two rows above.

It ships **off**, because the skills are worth their tokens until you say otherwise. Turn
it on for ordinary chats and leave it off when the skills *are* the work. Settings →
التكلفة sets what new chats start at; `/إعدادات` changes the chat in front of you. A design
session gets the full catalogue either way, because that surface lives on its skills.
(`core/designs.py::skills_note`, `ReplySettings.saver`, `AppSettings.token_saver`)

**Tools are described only when they apply.** `build_registry` takes a set of groups —
files, web, browser, issues, skills, mcp, desktop — and anything outside it is never sent.
A chat with no folder gets no file or shell tools, a machine with no connected tracker gets
no issue tools, and the browser and MCP groups have their own per-chat switches, because one
MCP server can add dozens of schemas. (`core/agent_runtime.py`, `core/chat_service.py::_groups`)

**Each note is tied to its tools.** The browser note is only sent when browser tools are,
the issues note only when an account is connected, and so on. A model is never told about a
tool it doesn't have — that only makes it apologise, and costs tokens to do it.

**Economy mode.** One switch in `/إعدادات`: no tools, no thinking, a short answer, one line
of system prompt. For questions the model answers from what it knows.

**Every reply length has a ceiling.** 500 / 1,500 / 4,000 tokens for short / balanced /
detailed. An unbounded reply is billed by the model's mood rather than by the task.

**Reading comes in pages.** `filesystem_read` returns 8,000 characters and tells the model
how to ask for the next page (`offset`); shell output is capped at 8,000 too.

**Summarising is triggered by weight.** A chat folds into its summary at 30 messages *or*
12,000 tokens, whichever comes first — ten long messages cost more than thirty short ones.

**Housekeeping runs on a cheap model.** Settings → Tasks & models → "model for Rafiq's own
work" folds long chats and writes commit messages, so that work isn't billed at the price of
the model you chat with.

**Fewer retries.** Each attempt resends the whole context; three is enough to ride out a
rate limit.

**The number is in front of you.** Every reply shows what it cost — tokens in, tokens out,
how many were cached, and the price.

## What was already right

The conversation history never replays tool calls or their output: only the user's messages
and the assistant's text go back. Old screenshots are replaced by a one-line placeholder.
Claude requests carry cache breakpoints (`llm/presets.py::with_cache_marks`) and the other
providers cache repeated prefixes themselves — which is why the fixed part of the prompt is
kept stable and first.

## If you want to spend even less

1. Turn on economy mode for ordinary questions, and "save tokens" (Settings → التكلفة) for
   everything except the chats where you're working *with* the skills.
2. Turn off MCP and browser tools in chats that don't need them.
3. Set a helper model, and a cheap task model.
4. Set a daily budget in Settings → Cost; Rafiq stops calling the provider when it's reached.
