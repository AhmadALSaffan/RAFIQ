"""English pages. Same structure as the Arabic ones."""


def download_band(icon: str, repo: str) -> str:
    return f"""
  <section class="section" id="download-band" style="padding-top: 24px">
    <div class="wrap">
      <div class="download reveal">
        <div>
          <h2>Ready? Half a minute and it's yours.</h2>
          <p class="lead" style="margin-top: 12px">One installer, no account. Then add a model key and start.</p>
          <div class="cta">
            <a class="btn btn-primary btn-lg" href="{repo}/releases/latest" data-download>{icon}Download for Windows</a>
            <a class="btn btn-ghost btn-lg" href="/en/download/">Install details</a>
          </div>
        </div>
        <ul class="meta">
          <li><b>System</b><span>Windows 10 or 11, x64</span></li>
          <li><b>Version</b><span data-version>0.3.0</span></li>
          <li><b>Size</b><span data-size>87 MB</span></li>
          <li><b>Install</b><span>Per user, no administrator rights needed</span></li>
        </ul>
      </div>
    </div>
  </section>
"""


def home(logos, icon, repo, base):
    return f"""
  <section class="hero">
    <div class="wrap">
      <div class="reveal">
        <h1>Gets the work done, <em>on your machine.</em></h1>
        <p class="lead">Connect the model you already use and give it real tools: files, shell, web, browser. Arabic-first, and every sensitive step waits for you.</p>
        <div class="cta">
          <a class="btn btn-primary btn-lg" href="{repo}/releases/latest" data-download>{icon}Download for Windows</a>
          <a class="btn btn-ghost btn-lg" href="#how">See how it works</a>
        </div>
      </div>
      <div class="hero-shot reveal">
        <div class="frame">
          <img src="/assets/screens/chat-plan.webp" width="2400" height="1500" alt="A chat in Rafiq: the user sent a three-point plan and the model split it into three tasks running in parallel, each with its live status" fetchpriority="high" />
        </div>
      </div>
    </div>
  </section>

  <section class="providers">
    <div class="wrap reveal">
      <p>Works with the model you already have, from twenty-one providers</p>
      {logos()}
    </div>
  </section>

  <section class="section" id="how">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>Three steps, then it works on its own</h2>
        <p class="lead">No account, no subscription. Your key, your machine, your folder.</p>
      </div>
      <div class="tabs reveal">
        <div class="tablist" role="tablist" aria-label="How to use it">
          <button class="tab" role="tab" aria-selected="true" aria-controls="p1" id="t1">
            <strong>Connect a model</strong>
            <span>Paste an API key, or sign in with a GitHub Copilot account. Rafiq lists the models and checks that they answer.</span>
          </button>
          <button class="tab" role="tab" aria-selected="false" aria-controls="p2" id="t2">
            <strong>Talk to it, or hand it a plan</strong>
            <span>A plain question, or a plan in a few lines. It splits the plan into tasks and you watch each one's status inside the chat.</span>
          </button>
          <button class="tab" role="tab" aria-selected="false" aria-controls="p3" id="t3">
            <strong>Watch, review, approve</strong>
            <span>Every tool shows up as a card. Writes and commands wait for your approval, and git changes are shown before they touch your folder.</span>
          </button>
        </div>
        <div class="tabpanels">
          <div class="tabpanel frame" id="p1" role="tabpanel" aria-labelledby="t1">
            <img src="/assets/screens/models.webp" width="2400" height="1500" alt="The Models page: five models from different providers, each verified with its latency and a fallback model" loading="lazy" />
          </div>
          <div class="tabpanel frame" id="p2" role="tabpanel" aria-labelledby="t2">
            <img src="/assets/screens/chat-plan.webp" width="2400" height="1500" alt="A three-point plan turned into three tasks with different statuses" loading="lazy" />
          </div>
          <div class="tabpanel frame" id="p3" role="tabpanel" aria-labelledby="t3">
            <img src="/assets/screens/task-detail.webp" width="2400" height="1500" alt="A task page: steps as tool cards, a permission request to run a command, and the git changes panel" loading="lazy" />
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="features" style="padding-top: 0">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>Built to do the work, not just answer</h2>
      </div>
      <div class="bento reveal">
        <a class="tile wide" href="/en/features/#tasks">
          <h3>Tasks in parallel</h3>
          <p>Up to 100 at once. Tasks that touch the same files take turns, tasks that depend on others wait. The reply keeps going even if you leave the page.</p>
          <div class="art"><img src="/assets/screens/crop-taskgroup.webp" width="1410" height="410" alt="A task group inside the chat: two completed and one running" loading="lazy" /></div>
        </a>
        <a class="tile third" href="/en/features/#git">
          <h3>A git worktree per task</h3>
          <p>On any git project, each task works in an isolated copy. Changes are listed as files and a diff, and one click reverts them.</p>
          <div class="art"><img src="/assets/screens/crop-changes.webp" width="1440" height="630" alt="The changes panel: 26 lines added and 3 removed, applied to the folder, with a revert button" loading="lazy" /></div>
        </a>
        <a class="tile half" href="/en/features/#designs">
          <h3>Design with a live preview</h3>
          <p>Answer a few questions and let the model design with bundled design skills. The preview sits beside the chat at phone, tablet and desktop widths, and one click hands it off to be built.</p>
          <div class="art"><img src="/assets/screens/crop-preview.webp" width="1550" height="1180" alt="A cafe landing page previewed inside Rafiq" loading="lazy" /></div>
        </a>
        <a class="tile half" href="/en/features/#cost">
          <h3>Cost in view, limits in your hands</h3>
          <p>Every call is counted in tokens and dollars per model. Set a daily or monthly limit and Rafiq stops before the invoice surprises you.</p>
          <div class="art"><img src="/assets/screens/crop-usage.webp" width="1240" height="380" alt="Spending today and this month, with daily and monthly limits and a thirty-day chart" loading="lazy" /></div>
        </a>
        <a class="tile third tinted" href="/en/features/#providers">
          <h3>Twenty-one providers, local models too</h3>
          <p>From Anthropic and OpenAI to Bedrock, Vertex and Ollama. A fallback model for each, and request limits so you never hit a rate-limit wall.</p>
          {logos("mini-logos")}
        </a>
        <a class="tile third" href="/en/features/#background">
          <h3>Keeps working in the background</h3>
          <p>Close the window and it carries on next to the clock. A notification when a task finishes or needs you, and scheduled tasks daily or every few hours.</p>
          <ul>
            <li>Starts with Windows if you like</li>
            <li>Templates for the tasks you repeat</li>
            <li>Updates itself from inside the app</li>
          </ul>
        </a>
      </div>
      <p class="reveal" style="margin-top: 28px"><a class="textlink" href="/en/features/">All features in detail</a></p>
    </div>
  </section>

  <section class="section" id="privacy" style="padding-top: 24px">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>On your machine, with your approval</h2>
      </div>
      <div class="principles reveal">
        <div class="principle">
          <h3>Keys in the Windows vault</h3>
          <p>API keys and tokens live in Windows Credential Manager only. They never enter the database, the logs, or the app's interface.</p>
        </div>
        <div class="principle">
          <h3>Every sensitive step asks</h3>
          <p>Writing a file, running a command, browsing, controlling the desktop, calling an MCP tool: each has its own policy. Ask, allow, or deny.</p>
        </div>
        <div class="principle">
          <h3>No Rafiq cloud</h3>
          <p>Your chats, tasks and designs are in a local database. Requests go straight to the provider you chose, and to nobody else.</p>
        </div>
      </div>
      <p class="reveal" style="margin-top: 28px"><a class="textlink" href="/en/security/">How Rafiq protects your data</a></p>
    </div>
  </section>

  <section class="section" style="padding-top: 32px">
    <div class="wrap">
      <div class="twoup reveal">
        <figure>
          <div class="frame"><img src="/assets/screens/tasks-light.webp" width="2400" height="1500" alt="The tasks page in light mode" loading="lazy" /></div>
          <figcaption>Light and dark, Arabic right-to-left from the ground up. Fully translated to English and Russian as well.</figcaption>
        </figure>
        <figure>
          <div class="frame"><img src="/assets/screens/tasks.webp" width="2400" height="1500" alt="The tasks page in dark mode" loading="lazy" /></div>
        </figure>
      </div>
    </div>
  </section>
{download_band(icon, repo)}
"""


def features(logos, icon, repo, base):
    return f"""
  <section class="page-head">
    <div class="wrap reveal">
      <h1>Features</h1>
      <p class="lead">Everything here ships in the app today. No "coming soon".</p>
    </div>
  </section>

  <section class="chapter" id="chat">
    <div class="wrap split">
      <div class="reveal">
        <h2>A chat that can do things</h2>
        <p>Talk to it like a colleague. It reads the files you point at with <code>@</code>, takes images and attachments, and answers in Markdown with highlighted code.</p>
        <ul class="checks">
          <li><code>/</code> commands set reply length, language, temperature and reasoning</li>
          <li><code>/summarize</code> folds a long chat into a summary and saves tokens</li>
          <li>Edit a question you already sent, or fork the chat from any point</li>
          <li>Dictate straight into the message box from the microphone</li>
          <li>The reply keeps going if you leave the page; come back and it's where it got to</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/chat-fx.webp" width="2400" height="1500" alt="A currency-rate chat: the web search tool card, then the answer with sources" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter alt" id="tasks">
    <div class="wrap">
      <div class="reveal stack">
        <h2>Tasks that run together, not one after another</h2>
        <p>Give it a job and let it finish on its own in your folder. Or send a plan in chat: it splits the plan into tasks, shows each one's status inside the conversation, and waits for the results to carry on.</p>
        <ul class="checks two">
          <li>Up to 100 tasks at once; the limit is yours</li>
          <li>Tasks touching the same files take turns automatically</li>
          <li>A task can wait for another to finish first</li>
          <li>A separate model for tasks: plan with the strong one, execute with the cheap one</li>
          <li>A full transcript of every step, and one-click re-run</li>
          <li>A Windows notification when a task finishes or needs your approval</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/tasks.webp" width="2400" height="1500" alt="The task list: seven tasks in completed, running and queued states, each with its model and folder" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter" id="git">
    <div class="wrap split flip">
      <div class="reveal">
        <h2>An isolated git worktree per task</h2>
        <p>When the folder is a git project, each task works in its own worktree, taken from your folder exactly as it is, uncommitted files included. So tasks on the same project run side by side without stepping on each other.</p>
        <ul class="checks">
          <li>A changes panel on every task: files, diff, line counts</li>
          <li>Revert everything the task did with one click</li>
          <li>Changes that didn't apply cleanly can be merged with conflict markers</li>
          <li>Rafiq never commits to your branch</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/crop-changes.webp" width="1440" height="630" alt="The changes panel on a task page" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter alt" id="designs">
    <div class="wrap">
      <div class="reveal stack">
        <h2>Design before you build</h2>
        <p><code>/impeccable init</code> asks nine questions about the project, then opens a design session: chat on one side, a live preview on the other at phone, tablet and desktop widths. The design skills are bundled and work with every model.</p>
      </div>
      <div class="frame reveal"><img src="/assets/screens/design.webp" width="2400" height="1500" alt="A design session: the model's decisions on the right, the page preview on the left" loading="lazy" /></div>
      <ul class="checks two reveal" style="margin-top: 28px">
        <li>Multi-page designs, with links opening inside the preview</li>
        <li>Every version saved as an HTML file in your folder</li>
        <li>One button hands the design to the chat or task that will build it</li>
        <li>Your own skills: add a folder with a SKILL.md and you're done</li>
      </ul>
    </div>
  </section>

  <section class="chapter" id="tools">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>The tools it gets</h2>
        <p class="lead">Every tool is classified: read-only, write, or execute. Writes and executes go through your permission policy.</p>
      </div>
      <div class="toolgrid reveal">
        <div><h3>Files and commands</h3><p>Read, write and delete inside the chat's or task's folder, shell commands with a timeout, and process management.</p></div>
        <div><h3>The web</h3><p><code>web_fetch</code> reads any page or PDF as clean text with its links. <code>web_search</code> searches through Brave, Tavily, or your own SearXNG server.</p></div>
        <div><h3>A real browser</h3><p>Microsoft Edge with its own profile: opens pages, clicks, types, reads and screenshots. Made for testing your site on localhost.</p></div>
        <div><h3>The desktop</h3><p>Off by default. When you turn it on: screenshots, mouse and keyboard on any app, one task at a time.</p></div>
        <div><h3>MCP servers</h3><p>Connect any Model Context Protocol server (a local command or HTTP) and its tools reach the model behind their own permission.</p></div>
        <div><h3>Issue trackers</h3><p>Jira, Linear, GitHub Issues and GitLab: the issues assigned to you in one place, to discuss in chat or turn into a task.</p></div>
      </div>
    </div>
  </section>

  <section class="chapter alt" id="providers">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>Your model, wherever it lives</h2>
        <p class="lead">An API key, a GitHub Copilot account, or a local model on your machine. Rafiq lists the models and checks that they answer before saving them.</p>
      </div>
      <div class="split reveal">
        <div>
          {logos("logo-grid")}
        </div>
        <div>
          <ul class="checks">
            <li>A fallback model per agent: if the provider goes down, the request goes to the backup on its own</li>
            <li>A cap on concurrent requests per key, and retries when the provider pushes back</li>
            <li>Azure, Bedrock and Vertex with their own fields: region, deployment, service account</li>
            <li>Claude models use prompt caching automatically, so long chats cost less</li>
            <li>Ollama and LM Studio with no key at all, and any server that speaks the OpenAI format</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="chapter" id="background">
    <div class="wrap split flip">
      <div class="reveal">
        <h2>Works while it's closed</h2>
        <p>Close the window and Rafiq stays next to the clock: tasks carry on, scheduled ones start on time, and you get a notification when one finishes or needs you.</p>
        <ul class="checks">
          <li>Scheduled tasks: every few minutes, daily at a time, or on chosen days</li>
          <li>Templates for the tasks you repeat, four included</li>
          <li>Starts with Windows if you enable it</li>
          <li>When you really quit, it leaves no process running behind</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/tasks-schedules.webp" width="2400" height="1500" alt="The scheduled tasks tab: a morning Jira summary every day at 9" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter alt" id="cost">
    <div class="wrap split">
      <div class="reveal">
        <h2>Cost, out in the open</h2>
        <p>Every call is recorded: prompt, completion and cached tokens, priced from the provider's own rate table. You see today, this month, the last thirty days, and a breakdown per model.</p>
        <ul class="checks">
          <li>A daily and a monthly limit in dollars; Rafiq stops when you reach one</li>
          <li>Models with no known price are counted in tokens only, no invented numbers</li>
          <li>A diagnostics report as JSON: app version, settings and provider names, with no keys</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/settings-usage.webp" width="2400" height="1500" alt="The Usage section in Settings" loading="lazy" /></div>
    </div>
  </section>
{download_band(icon, repo)}
"""


def security(logos, icon, repo, base):
    return f"""
  <section class="page-head">
    <div class="wrap reveal">
      <h1>Security and privacy</h1>
      <p class="lead">Rafiq gives a model real power over your machine. So every permission is yours, and every secret is where it belongs.</p>
    </div>
  </section>

  <section class="chapter">
    <div class="wrap">
      <div class="section-head reveal"><h2>Where everything is kept</h2></div>
      <div class="table-wrap reveal">
        <table>
          <thead><tr><th>What</th><th>Where</th><th>Who can read it</th></tr></thead>
          <tbody>
            <tr><td>API keys and account tokens</td><td>Windows Credential Manager</td><td>Rafiq's engine only, at call time</td></tr>
            <tr><td>Search keys and MCP server secrets</td><td>Windows Credential Manager</td><td>Rafiq's engine only</td></tr>
            <tr><td>Chats, tasks and designs</td><td>A local SQLite database in AppData</td><td>You, and the app</td></tr>
            <tr><td>Settings and the permission policy</td><td>The same local database</td><td>You, and the app</td></tr>
            <tr><td>The files the model works on</td><td>Your folder, or an isolated git copy of it</td><td>Sent to the provider you chose, only when the model asks for them</td></tr>
          </tbody>
        </table>
      </div>
      <p class="muted reveal" style="margin-top: 14px; font-size: 15px">Keys never enter the database or the log files, and are never sent to the app's interface. The diagnostics report you can export from Settings carries provider names only, with no key and no conversation content.</p>
    </div>
  </section>

  <section class="chapter alt">
    <div class="wrap split">
      <div class="reveal">
        <h2>A permission policy per tool type</h2>
        <p>Every tool is classified: read, write, or execute. Reads pass on their own. The rest go through your policy: <b>ask</b> every time, <b>allow</b> always, or <b>deny</b>.</p>
        <ul class="checks">
          <li>File writes, shell commands, process management</li>
          <li>Web and browser, and desktop control</li>
          <li>Edits to Jira and other issues, and MCP tools</li>
          <li>The request appears inside the chat or the task page, with the exact command or path</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/crop-permissions.webp" width="1250" height="1100" alt="The permission policy in Settings: seven categories, each set to ask every time" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter">
    <div class="wrap">
      <div class="section-head reveal"><h2>Limits built into the tools themselves</h2></div>
      <div class="principles reveal">
        <div class="principle">
          <h3>Desktop control is off</h3>
          <p>You have to switch it on in Settings before the model even sees it. Even then, every action goes through the permission.</p>
        </div>
        <div class="principle">
          <h3>The web can't reach your network</h3>
          <p>The page-reading tool refuses private and local addresses, so it can't be used to reach devices on your network.</p>
        </div>
        <div class="principle">
          <h3>git without commits</h3>
          <p>Task worktrees are created and removed only inside Rafiq's data folder. The model can't commit to your branch or change it.</p>
        </div>
        <div class="principle">
          <h3>A browser with its own profile</h3>
          <p>The browser tools run Edge with a separate profile. Your accounts and cookies in your everyday browser are never touched.</p>
        </div>
        <div class="principle">
          <h3>A local engine with a session token</h3>
          <p>Rafiq's engine runs on your machine on a local port, with a random token per launch. No other process on the machine can call it.</p>
        </div>
        <div class="principle">
          <h3>Signed updates</h3>
          <p>The app verifies the signature of every update before installing it. A tampered update doesn't get through.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="chapter alt">
    <div class="wrap">
      <div class="section-head reveal"><h2>Who Rafiq talks to</h2></div>
      <div class="reveal stack">
        <p>Four parties, all chosen by you: the provider whose key you added, the search service if you enabled one, the MCP servers you connected, and GitHub's releases page to check for updates. No analytics, no tracking, no Rafiq server.</p>
      </div>
    </div>
  </section>
{download_band(icon, repo)}
"""


def download(logos, icon, repo, base):
    return f"""
  <section class="page-head">
    <div class="wrap reveal">
      <h1>Download Rafiq for Windows</h1>
      <p class="lead">One installer, no account. After installing, add a model key on the Models page and start.</p>
      <div class="cta" style="margin-top: 26px">
        <a class="btn btn-primary btn-lg" href="{repo}/releases/latest" data-download>{icon}Download for Windows</a>
        <a class="btn btn-ghost btn-lg" href="{repo}/releases" target="_blank" rel="noopener">All releases</a>
      </div>
      <ul class="meta inline">
        <li><b>Version</b><span data-version>0.3.0</span></li>
        <li><b>Size</b><span data-size>87 MB</span></li>
        <li><b>System</b><span>Windows 10 or 11, x64</span></li>
      </ul>
    </div>
  </section>

  <section class="chapter">
    <div class="wrap">
      <div class="section-head reveal"><h2>Installing</h2></div>
      <div class="steps reveal">
        <div><h3>Run the installer</h3><p>It installs for the current user without administrator rights, in Arabic, English or Russian, and adds a shortcut to the Start menu and the desktop.</p></div>
        <div><h3>Add a model</h3><p>On the Models page: pick the provider, paste the key or sign in with GitHub, and choose the model from the list. Rafiq sends a test message to make sure it works.</p></div>
        <div><h3>Start</h3><p>A chat, a task on a folder, or a design. Upgrading to a newer version keeps your models, chats, tasks and accounts.</p></div>
      </div>
    </div>
  </section>

  <section class="chapter alt">
    <div class="wrap split">
      <div class="reveal">
        <h2>The SmartScreen warning</h2>
        <p>The installer isn't signed with a code-signing certificate yet, so Windows may stop it the first time. Click <b>More info</b>, then <b>Run anyway</b>. To make sure the file is the one we published, compare its hash with the <code>SHA256SUMS.txt</code> attached to the release:</p>
        <pre class="code" dir="ltr"><code>Get-FileHash .\\Rafiq_&lt;version&gt;_x64-setup.exe -Algorithm SHA256</code></pre>
      </div>
      <div class="reveal">
        <h2>Updates</h2>
        <p>From the About page in the app: check, download, and restart into the new version. Every update is signed, and the app verifies the signature before installing it.</p>
        <p style="margin-top: 14px">You can also download any release by hand from the releases page on GitHub and install it over the current one.</p>
      </div>
    </div>
  </section>

  <section class="chapter">
    <div class="wrap">
      <div class="section-head reveal"><h2>Where your data lives</h2></div>
      <div class="table-wrap reveal">
        <table>
          <tbody>
            <tr><td>The app</td><td dir="ltr">%LOCALAPPDATA%\\رفيق</td></tr>
            <tr><td>Database and logs</td><td dir="ltr">%APPDATA%\\Rafiq</td></tr>
            <tr><td>Keys and tokens</td><td>Windows Credential Manager</td></tr>
            <tr><td>Files of tasks without a folder, and designs</td><td dir="ltr">%APPDATA%\\Rafiq\\workspace</td></tr>
          </tbody>
        </table>
      </div>
      <p class="muted reveal" style="margin-top: 14px; font-size: 15px">Uninstalling from Apps &amp; features removes the app and leaves your data in place, so a later install brings it back as it was.</p>
    </div>
  </section>
"""


FAQ_ITEMS = [
    ("Is Rafiq free?", "The app is free and the code is on GitHub. What you pay for is the model usage at the provider you chose, or nothing at all with a local model through Ollama or LM Studio."),
    ("How is it different from the ChatGPT or Claude website?", "Websites answer you. Rafiq works: it reads and writes your files, runs commands, browses, and carries out whole tasks on your folder, with every sensitive step going through your approval."),
    ("Which models does it support?", "Twenty-one providers: Anthropic, OpenAI, Google Gemini, DeepSeek, Mistral, xAI, OpenRouter, GitHub Copilot, Azure OpenAI, AWS Bedrock, Google Vertex AI, Groq, Cerebras, Fireworks, Together, Qwen, Kimi and GLM, plus Ollama and LM Studio locally, and any OpenAI-compatible server."),
    ("Does it work offline?", "With a local model (Ollama or LM Studio), yes: files, commands and designs are all local. The web tools naturally need a connection."),
    ("Are my files sent anywhere?", "Only what the model asks for to do your job, and straight to the provider whose key you added. There is no Rafiq server in between, no analytics, no tracking."),
    ("Do I need a Copilot subscription?", "Only if you want to use GitHub Copilot models. You sign in with a GitHub account that has an active Copilot plan, without pasting any key."),
    ("Why does Windows warn me during installation?", "Because the installer isn't signed with a code-signing certificate yet. Click More info, then Run anyway, and compare the file's hash with the SHA256SUMS.txt attached to the release if you want to be sure."),
    ("Does it run on macOS or Linux?", "Windows 10 and 11 only for now. The architecture is ready for other systems, but there is no published build for them yet."),
    ("How does Rafiq know model prices?", "From the providers' own rate tables. A model with no known price is counted in tokens only; it never invents a number."),
    ("I found a problem. Where do I report it?", "Open an issue on GitHub and attach the diagnostics report from Settings → Usage: a JSON file with the app version, your settings and provider names, with no key and no conversation content."),
]


def faq(logos, icon, repo, base):
    items = "".join(
        f'<details class="faq"{" open" if i == 0 else ""}><summary>{q}</summary><p>{a}</p></details>' for i, (q, a) in enumerate(FAQ_ITEMS)
    )
    return f"""
  <section class="page-head">
    <div class="wrap reveal">
      <h1>Frequently asked</h1>
      <p class="lead">If your answer isn't here, open a question on GitHub.</p>
    </div>
  </section>
  <section class="chapter" style="padding-top: 8px">
    <div class="wrap narrow reveal">
      {items}
    </div>
  </section>
{download_band(icon, repo)}
"""


LANG = {
    "code": "en",
    "dir": "ltr",
    "name": "English",
    "base": "/en/",
    "brand": "Rafiq",
    "download": "Download for Windows",
    "menu": "Menu",
    "nav_label": "Sections",
    "links_label": "Links",
    "releases": "Releases",
    "report": "Report a problem",
    "footer_made": 'Rafiq · made by <a href="https://github.com/AhmadALSaffan" target="_blank" rel="noopener">Ahmed Eliwi AL Saffan</a>',
    "preload": ["plex-arabic-latin-700.woff2", "plex-arabic-latin-400.woff2"],
    "pages": [
        {"path": "", "nav": "Home", "title": "Rafiq · An AI agent for Windows that works on your own machine", "description": "Rafiq is a Windows desktop app that connects the model you already use and gives it real tools: files, commands, the web, a browser, and design with a live preview. Arabic-first, local, and nothing sensitive without your approval.", "body": home},
        {"path": "features/", "nav": "Features", "title": "Features · Rafiq", "description": "Chats with tools, parallel tasks, a git worktree per task, design with a live preview, twenty-one providers, scheduling, and cost out in the open.", "body": features},
        {"path": "security/", "nav": "Security", "title": "Security and privacy · Rafiq", "description": "Where your keys and data are kept, how the permission policy works, and who Rafiq talks to.", "body": security},
        {"path": "download/", "nav": "Download", "title": "Download Rafiq for Windows", "description": "One installer for Windows 10 and 11, no account. Install steps, file verification, and updates.", "body": download},
        {"path": "faq/", "nav": "FAQ", "title": "Frequently asked · Rafiq", "description": "Is it free? Which models? Are my files sent anywhere? Short answers.", "body": faq},
    ],
}
