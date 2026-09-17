"""Arabic pages. Each page body is a function so it can use the shared helpers."""

# ── Shared ─────────────────────────────────────────────────────────────────────


def download_band(icon: str, repo: str) -> str:
    return f"""
  <section class="section" id="download-band" style="padding-top: 24px">
    <div class="wrap">
      <div class="download reveal">
        <div>
          <h2>جاهز؟ نصف دقيقة وبيكون عندك.</h2>
          <p class="lead" style="margin-top: 12px">مثبّت واحد، بدون حساب. بعدها ضيف مفتاح نموذجك وابدأ.</p>
          <div class="cta">
            <a class="btn btn-primary btn-lg" href="{repo}/releases/latest" data-download>{icon}حمّل لويندوز</a>
            <a class="btn btn-ghost btn-lg" href="/download/">تفاصيل التثبيت</a>
          </div>
        </div>
        <ul class="meta">
          <li><b>النظام</b><span>Windows 10 أو 11، x64</span></li>
          <li><b>الإصدار</b><span data-version>0.3.0</span></li>
          <li><b>الحجم</b><span data-size>87 MB</span></li>
          <li><b>الصلاحيات</b><span>بيتثبّت للمستخدم الحالي، بدون صلاحيات مدير</span></li>
        </ul>
      </div>
    </div>
  </section>
"""


# ── Home ───────────────────────────────────────────────────────────────────────


def home(logos, icon, repo, base):
    return f"""
  <section class="hero">
    <div class="wrap">
      <div class="reveal">
        <h1>مساعد ذكي بيحكي عربي، <em>وبيخلّص الشغل</em> على جهازك.</h1>
        <p class="lead">اربط النموذج اللي بتستخدمه أصلاً، واعطيه أدوات حقيقية: ملفاتك، أوامرك، الويب، والمتصفح. كل خطوة حسّاسة بإذنك.</p>
        <div class="cta">
          <a class="btn btn-primary btn-lg" href="{repo}/releases/latest" data-download>{icon}حمّل لويندوز</a>
          <a class="btn btn-ghost btn-lg" href="#how">شوف كيف بيشتغل</a>
        </div>
      </div>
      <div class="hero-shot reveal">
        <div class="frame">
          <img src="/assets/screens/chat-plan.webp" width="2400" height="1500" alt="محادثة في رفيق: المستخدم بعت خطة من ثلاث نقاط، والنموذج قسّمها لثلاث مهام بتشتغل بالتوازي مع حالة كل وحدة" fetchpriority="high" />
        </div>
      </div>
    </div>
  </section>

  <section class="providers">
    <div class="wrap reveal">
      <p>بيشتغل مع النموذج اللي عندك، من واحد وعشرين مزوّد</p>
      {logos()}
    </div>
  </section>

  <section class="section" id="how">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>ثلاث خطوات، وبعدها بيشتغل لحاله</h2>
        <p class="lead">ما في حساب ولا اشتراك. مفتاحك، جهازك، ومجلدك.</p>
      </div>
      <div class="tabs reveal">
        <div class="tablist" role="tablist" aria-label="خطوات الاستخدام">
          <button class="tab" role="tab" aria-selected="true" aria-controls="p1" id="t1">
            <strong>اربط نموذج</strong>
            <span>حط مفتاح API أو سجّل دخول بحساب GitHub Copilot. رفيق بيجيب قائمة الموديلات وبيتأكد إنها شغّالة.</span>
          </button>
          <button class="tab" role="tab" aria-selected="false" aria-controls="p2" id="t2">
            <strong>احكي معه، أو اعطيه خطة</strong>
            <span>سؤال عادي، أو خطة من كم نقطة. بيقسمها لمهام وبتشوف حالة كل وحدة جوّا المحادثة.</span>
          </button>
          <button class="tab" role="tab" aria-selected="false" aria-controls="p3" id="t3">
            <strong>راقب، وراجع، ووافق</strong>
            <span>كل أداة بتظهر كبطاقة. الكتابة والأوامر بتستنى إذنك، والتغييرات على git بتنعرض قبل ما تنطبق.</span>
          </button>
        </div>
        <div class="tabpanels">
          <div class="tabpanel frame" id="p1" role="tabpanel" aria-labelledby="t1">
            <img src="/assets/screens/models.webp" width="2400" height="1500" alt="صفحة النماذج: خمس نماذج من مزوّدين مختلفين، كل واحد متحقق منه مع زمن الاستجابة ونموذج احتياطي" loading="lazy" />
          </div>
          <div class="tabpanel frame" id="p2" role="tabpanel" aria-labelledby="t2">
            <img src="/assets/screens/chat-plan.webp" width="2400" height="1500" alt="خطة من ثلاث نقاط تحوّلت لثلاث مهام بحالات مختلفة" loading="lazy" />
          </div>
          <div class="tabpanel frame" id="p3" role="tabpanel" aria-labelledby="t3">
            <img src="/assets/screens/task-detail.webp" width="2400" height="1500" alt="صفحة مهمة: الخطوات كبطاقات أدوات، وطلب إذن لتشغيل أمر، ولوحة التغييرات على git" loading="lazy" />
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="features" style="padding-top: 0">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>مبني ليشتغل فعلاً، مو بس يجاوب</h2>
      </div>
      <div class="bento reveal">
        <a class="tile wide" href="/features/#tasks">
          <h3>مهام بالتوازي</h3>
          <p>لحد 100 مهمة بنفس الوقت. اللي بتلمس نفس الملفات بتاخد دورها، واللي بتعتمد على غيرها بتستنى. والرد بيكمل حتى لو طلعت من الصفحة.</p>
          <div class="art"><img src="/assets/screens/crop-taskgroup.webp" width="1410" height="410" alt="مجموعة مهام داخل المحادثة: اثنتان مكتملتان وواحدة شغّالة" loading="lazy" /></div>
        </a>
        <a class="tile third" href="/features/#git">
          <h3>نسخة git لكل مهمة</h3>
          <p>على أي مشروع git، كل مهمة بتشتغل بنسخة معزولة. التغييرات بتنعرض بالملفات والفرق، وبتقدر ترجّعها بضغطة.</p>
          <div class="art"><img src="/assets/screens/crop-changes.webp" width="1440" height="630" alt="لوحة التغييرات: 26 سطر مضاف و3 محذوفة، مطبّقة على المجلد مع زر رجّع" loading="lazy" /></div>
        </a>
        <a class="tile half" href="/features/#designs">
          <h3>تصميم بمعاينة حيّة</h3>
          <p>جاوب على كم سؤال، وخلّي النموذج يصمّم بمهارات تصميم مدمجة. المعاينة بجنبك بعرض الموبايل والتابلت والشاشة، وبضغطة بتبعتها للبرمجة.</p>
          <div class="art"><img src="/assets/screens/crop-preview.webp" width="1550" height="1180" alt="معاينة تصميم صفحة مقهى داخل رفيق" loading="lazy" /></div>
        </a>
        <a class="tile half" href="/features/#cost">
          <h3>الكلفة قدّامك، والحد بإيدك</h3>
          <p>كل نداء بينحسب بالتوكنات والدولار لكل نموذج. حط حد يومي أو شهري، ورفيق بيوقف قبل ما تفاجأ بالفاتورة.</p>
          <div class="art"><img src="/assets/screens/crop-usage.webp" width="1240" height="380" alt="مصروف اليوم والشهر مع حد يومي وشهري ورسم بياني لثلاثين يوم" loading="lazy" /></div>
        </a>
        <a class="tile third tinted" href="/features/#providers">
          <h3>واحد وعشرين مزوّد، ونماذج محلية</h3>
          <p>من Anthropic و OpenAI لحد Bedrock و Vertex و Ollama. نموذج احتياطي لكل واحد، وحدود طلبات عشان ما توقع بـ rate limit.</p>
          {logos("mini-logos")}
        </a>
        <a class="tile third" href="/features/#background">
          <h3>بيضل شغّال بالخلفية</h3>
          <p>سكّر النافذة وهو بيكمل بجنب الساعة. إشعار لما مهمة تخلص أو بدها إذنك، ومهام مجدولة كل يوم أو كل كم ساعة.</p>
          <ul>
            <li>بيبلش مع ويندوز إذا بدك</li>
            <li>قوالب للمهام اللي بتتكرر</li>
            <li>يحدّث نفسه من داخل التطبيق</li>
          </ul>
        </a>
      </div>
      <p class="reveal" style="margin-top: 28px"><a class="textlink" href="/features/">كل الميزات بالتفصيل</a></p>
    </div>
  </section>

  <section class="section" id="privacy" style="padding-top: 24px">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>على جهازك، وبإذنك</h2>
      </div>
      <div class="principles reveal">
        <div class="principle">
          <h3>المفاتيح بخزنة ويندوز</h3>
          <p>مفاتيح API والتوكنات بتنحفظ في Windows Credential Manager بس. ما بتدخل قاعدة البيانات، ولا السجلات، ولا بتنبعت للواجهة.</p>
        </div>
        <div class="principle">
          <h3>كل خطوة حسّاسة بتسألك</h3>
          <p>كتابة ملف، أمر، تصفّح، تحكّم بسطح المكتب، أداة MCP: كل وحدة إلها سياسة. اسأل، أو اسمح، أو امنع.</p>
        </div>
        <div class="principle">
          <h3>ما في سحابة خاصة برفيق</h3>
          <p>محادثاتك ومهامك وتصاميمك في قاعدة بيانات محلية. الطلبات بتروح مباشرة للمزوّد اللي اخترته، ولا لحدا غيره.</p>
        </div>
      </div>
      <p class="reveal" style="margin-top: 28px"><a class="textlink" href="/security/">كيف بيحمي رفيق بياناتك</a></p>
    </div>
  </section>

  <section class="section" style="padding-top: 32px">
    <div class="wrap">
      <div class="twoup reveal">
        <figure>
          <div class="frame"><img src="/assets/screens/tasks-light.webp" width="2400" height="1500" alt="صفحة المهام بالوضع الفاتح" loading="lazy" /></div>
          <figcaption>فاتح وغامق، والعربية من اليمين لليسار من الأساس. بالإنجليزية والروسية كمان.</figcaption>
        </figure>
        <figure>
          <div class="frame"><img src="/assets/screens/tasks.webp" width="2400" height="1500" alt="صفحة المهام بالوضع الغامق" loading="lazy" /></div>
        </figure>
      </div>
    </div>
  </section>
{download_band(icon, repo)}
"""


# ── Features ───────────────────────────────────────────────────────────────────


def features(logos, icon, repo, base):
    return f"""
  <section class="page-head">
    <div class="wrap reveal">
      <h1>الميزات</h1>
      <p class="lead">كل شي هون موجود بالتطبيق اليوم. ما في «قريباً».</p>
    </div>
  </section>

  <section class="chapter" id="chat">
    <div class="wrap split">
      <div class="reveal">
        <h2>محادثة بتقدر تعمل شي</h2>
        <p>احكي معه متل ما بتحكي مع زميل. بيقرأ الملفات اللي بتشير عليها بـ <code>@</code>، بياخد صور ومرفقات، وبيرد بـ Markdown مع الكود ملوّن.</p>
        <ul class="checks">
          <li>أوامر <code>/</code> لضبط طول الرد ولغته وحرارته والتفكير</li>
          <li><code>/لخّص</code> بيطوي المحادثة الطويلة بملخص فتوفّر توكنات</li>
          <li>عدّل سؤال بعتّه وابعته من جديد، أو فرّع المحادثة من أي نقطة</li>
          <li>إملاء صوتي من المايك مباشرة لصندوق الكتابة</li>
          <li>الرد بيكمل لو طلعت من الصفحة، وبترجع تلاقيه وين وصل</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/chat-fx.webp" width="2400" height="1500" alt="محادثة بحث عن سعر صرف: بطاقة أداة البحث ثم الجواب مع المصادر" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter alt" id="tasks">
    <div class="wrap">
      <div class="reveal stack">
        <h2>مهام بتشتغل مع بعض، مو ورا بعض</h2>
        <p>اعطيه شغلة وخلّيه يخلصها لحاله بمجلدك. أو ابعت خطة بالمحادثة وهو بيقسمها لمهام، بيعرض حالة كل وحدة جوّا الشات، وبيستنى النتايج ليكمل عليها.</p>
        <ul class="checks two">
          <li>لحد 100 مهمة بنفس الوقت، والحد بإيدك</li>
          <li>المهام اللي بتلمس نفس الملفات بتاخد دورها تلقائياً</li>
          <li>مهمة بتقدر تستنى مهمة تانية تخلص قبلها</li>
          <li>نموذج مختلف للمهام: خطّط بالقوي ونفّذ بالأرخص</li>
          <li>سجل كامل لكل خطوة، وإعادة تشغيل بضغطة</li>
          <li>إشعار ويندوز لما مهمة تخلص أو بدها إذنك</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/tasks.webp" width="2400" height="1500" alt="قائمة المهام: سبع مهام بحالات مكتمل وشغّال وبالدور، مع النموذج والمجلد لكل وحدة" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter" id="git">
    <div class="wrap split flip">
      <div class="reveal">
        <h2>نسخة git معزولة لكل مهمة</h2>
        <p>لما المجلد مشروع git، كل مهمة بتشتغل بـ worktree خاص فيها، مأخوذ من مجلدك متل ما هو حتى مع الملفات اللي ما عملتلها commit. فمهام نفس المشروع بتشتغل مع بعض بدون ما تخرّب على بعض.</p>
        <ul class="checks">
          <li>لوحة تغييرات بكل مهمة: الملفات، الفرق، وعدد الأسطر</li>
          <li>رجّع كل اللي عملته المهمة بضغطة</li>
          <li>التغييرات اللي ما انطبقت لحالها بتقدر تدمجها مع علامات تعارض</li>
          <li>رفيق ما بيعمل commit على فرعك أبداً</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/crop-changes.webp" width="1440" height="630" alt="لوحة التغييرات في صفحة المهمة" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter alt" id="designs">
    <div class="wrap">
      <div class="reveal stack">
        <h2>صمّم قبل ما تبرمج</h2>
        <p><code>/impeccable init</code> بيسألك تسع أسئلة عن المشروع، وبعدها بتفتح جلسة تصميم: شات على جنب، ومعاينة حيّة على الجنب التاني بعرض الموبايل والتابلت والشاشة. مهارات التصميم مدمجة وبتشتغل مع أي نموذج.</p>
      </div>
      <div class="frame reveal"><img src="/assets/screens/design.webp" width="2400" height="1500" alt="جلسة تصميم: قرارات النموذج على اليمين ومعاينة الصفحة على اليسار" loading="lazy" /></div>
      <ul class="checks two reveal" style="margin-top: 28px">
        <li>تصاميم من أكتر من صفحة، والروابط بتفتح جوّا المعاينة</li>
        <li>كل نسخة بتنحفظ كملف HTML بمجلدك</li>
        <li>زر واحد بيبعت التصميم للمحادثة أو المهمة اللي رح تبرمجه</li>
        <li>مهاراتك الخاصة: أضف مجلد فيه SKILL.md وخلص</li>
      </ul>
    </div>
  </section>

  <section class="chapter" id="tools">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>الأدوات اللي بتوصله</h2>
        <p class="lead">كل أداة مصنّفة: قراءة بس، أو كتابة، أو تنفيذ. والكتابة والتنفيذ بيمرقوا من سياسة الصلاحيات تبعتك.</p>
      </div>
      <div class="toolgrid reveal">
        <div><h3>الملفات والأوامر</h3><p>قراءة وكتابة وحذف جوّا مجلد المحادثة أو المهمة، وأوامر shell بمهلة زمنية، وإدارة العمليات.</p></div>
        <div><h3>الويب</h3><p><code>web_fetch</code> بيقرأ أي صفحة أو PDF كنص مرتب مع روابطه. <code>web_search</code> بيدوّر عبر Brave أو Tavily أو خادم SearXNG خاص فيك.</p></div>
        <div><h3>متصفح حقيقي</h3><p>Microsoft Edge بملف تعريف خاص: بيفتح صفحات، بيضغط، بيكتب، بيقرأ، وبيصوّر. مناسب لتجربة موقعك على localhost.</p></div>
        <div><h3>سطح المكتب</h3><p>مطفي افتراضياً. لما تشغّله: صورة شاشة، فأرة، وكيبورد على أي تطبيق، مهمة وحدة بالمرة.</p></div>
        <div><h3>خوادم MCP</h3><p>اربط أي خادم Model Context Protocol (أمر محلي أو HTTP) وأدواته بتصير عند النموذج بصلاحيتها الخاصة.</p></div>
        <div><h3>أنظمة التتبّع</h3><p>Jira و Linear و GitHub Issues و GitLab: مهامك المسندة إلك بمكان واحد، وبتقدر تشاور عليها أو تحوّلها لمهمة.</p></div>
      </div>
    </div>
  </section>

  <section class="chapter alt" id="providers">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>نموذجك، من وين ما كان</h2>
        <p class="lead">مفتاح API، أو حساب GitHub Copilot، أو نموذج محلي على جهازك. رفيق بيجيب قائمة الموديلات وبيتأكد إنها بترد قبل ما يحفظها.</p>
      </div>
      <div class="split reveal">
        <div>
          {logos("logo-grid")}
        </div>
        <div>
          <ul class="checks">
            <li>نموذج احتياطي لكل وكيل: إذا المزوّد وقع، الطلب بيروح للبديل تلقائياً</li>
            <li>حد للطلبات المتزامنة على نفس المفتاح، وإعادة محاولة لما المزوّد يضغط</li>
            <li>Azure و Bedrock و Vertex بحقولها الخاصة: المنطقة، الـ deployment، حساب الخدمة</li>
            <li>نماذج Claude بتستفيد من الكاش تلقائياً فالمحادثات الطويلة بتكلّف أقل</li>
            <li>Ollama و LM Studio بدون مفتاح، وأي خادم بيحكي بصيغة OpenAI</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="chapter" id="background">
    <div class="wrap split flip">
      <div class="reveal">
        <h2>بيشتغل وإنت مش فاتحه</h2>
        <p>سكّر النافذة ورفيق بيضل بجنب الساعة: المهام بتكمل، والمجدولة بتبلش بوقتها، وبيطلعلك إشعار لما وحدة تخلص أو بدها إذنك.</p>
        <ul class="checks">
          <li>مهام مجدولة: كل كم دقيقة، يومياً بساعة محددة، أو بأيام معيّنة</li>
          <li>قوالب للمهام اللي بتتكرر، مع أربعة جاهزين</li>
          <li>بيبلش مع ويندوز إذا فعّلتها</li>
          <li>لما تنهيه فعلاً، ما بيترك أي عملية شغّالة وراه</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/tasks-schedules.webp" width="2400" height="1500" alt="تبويب المهام المجدولة: ملخص Jira الصباحي كل يوم الساعة 9" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter alt" id="cost">
    <div class="wrap split">
      <div class="reveal">
        <h2>الكلفة على المكشوف</h2>
        <p>كل نداء بينسجّل: توكنات الطلب والرد والكاش، وسعره من جدول أسعار المزوّد نفسه. بتشوف اليوم والشهر وآخر ثلاثين يوم، وتفصيل لكل نموذج.</p>
        <ul class="checks">
          <li>حد يومي وحد شهري بالدولار، ورفيق بيوقف لما توصله</li>
          <li>النماذج اللي ما إلها سعر معروف بتنعدّ بالتوكنات بس، بلا أرقام مخترعة</li>
          <li>تقرير للمشاكل بملف JSON: نسخة التطبيق وإعداداتك وأسماء المزوّدين، بلا مفاتيح</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/settings-usage.webp" width="2400" height="1500" alt="قسم الاستهلاك في الإعدادات" loading="lazy" /></div>
    </div>
  </section>
{download_band(icon, repo)}
"""


# ── Security ───────────────────────────────────────────────────────────────────


def security(logos, icon, repo, base):
    return f"""
  <section class="page-head">
    <div class="wrap reveal">
      <h1>الأمان والخصوصية</h1>
      <p class="lead">رفيق بيعطي النموذج صلاحيات حقيقية على جهازك. لهيك كل صلاحية بإيدك، وكل سر بمكانه الصحيح.</p>
    </div>
  </section>

  <section class="chapter">
    <div class="wrap">
      <div class="section-head reveal"><h2>وين بتنحفظ كل شغلة</h2></div>
      <div class="table-wrap reveal">
        <table>
          <thead><tr><th>الشي</th><th>وين</th><th>مين بيقدر يقرأه</th></tr></thead>
          <tbody>
            <tr><td>مفاتيح API وتوكنات الحسابات</td><td>Windows Credential Manager</td><td>محرّك رفيق بس، وقت النداء</td></tr>
            <tr><td>مفاتيح البحث وأسرار خوادم MCP</td><td>Windows Credential Manager</td><td>محرّك رفيق بس</td></tr>
            <tr><td>المحادثات والمهام والتصاميم</td><td>قاعدة SQLite محلية في مجلد AppData</td><td>إنت، والتطبيق</td></tr>
            <tr><td>الإعدادات وسياسة الصلاحيات</td><td>نفس القاعدة المحلية</td><td>إنت، والتطبيق</td></tr>
            <tr><td>الملفات اللي بيشتغل عليها النموذج</td><td>مجلدك، أو نسخة git معزولة منه</td><td>بتنبعت للمزوّد اللي اخترته بس لما النموذج يطلبها</td></tr>
          </tbody>
        </table>
      </div>
      <p class="muted reveal" style="margin-top: 14px; font-size: 15px">المفاتيح ما بتدخل قاعدة البيانات ولا ملفات السجل، وما بتنبعت لواجهة التطبيق. تقرير المشاكل اللي بتصدّره من الإعدادات بيحمل أسماء المزوّدين بس، بلا أي مفتاح ولا محتوى محادثة.</p>
    </div>
  </section>

  <section class="chapter alt">
    <div class="wrap split">
      <div class="reveal">
        <h2>سياسة صلاحيات لكل نوع أداة</h2>
        <p>كل أداة مصنّفة: قراءة، أو كتابة، أو تنفيذ. القراءة بتمشي لحالها. الباقي بيمرق من سياستك: <b>اسأل</b> كل مرة، أو <b>اسمح</b> دايماً، أو <b>امنع</b>.</p>
        <ul class="checks">
          <li>الكتابة على الملفات، أوامر shell، إدارة العمليات</li>
          <li>الويب والمتصفح، والتحكم بسطح المكتب</li>
          <li>التعديل على مهام Jira وغيرها، وأدوات MCP</li>
          <li>طلب الإذن بيظهر جوّا المحادثة أو صفحة المهمة، مع الأمر أو المسار بالضبط</li>
        </ul>
      </div>
      <div class="frame reveal"><img src="/assets/screens/crop-permissions.webp" width="1250" height="1100" alt="سياسة الصلاحيات في الإعدادات: سبع فئات، كل وحدة على «اسأل دايماً»" loading="lazy" /></div>
    </div>
  </section>

  <section class="chapter">
    <div class="wrap">
      <div class="section-head reveal"><h2>حدود مبنية جوّا الأدوات نفسها</h2></div>
      <div class="principles reveal">
        <div class="principle">
          <h3>التحكم بسطح المكتب مطفي</h3>
          <p>لازم تفعّله بنفسك من الإعدادات قبل ما يظهر للنموذج أصلاً. وحتى بعدها، كل حركة بتمرق من الصلاحية.</p>
        </div>
        <div class="principle">
          <h3>الويب ما بيوصل لشبكتك</h3>
          <p>أداة قراءة الصفحات بترفض العناوين الداخلية والمحلية، فما بتقدر تستخدمها للوصول لأجهزة شبكتك.</p>
        </div>
        <div class="principle">
          <h3>git بلا commit</h3>
          <p>نسخ المهام المعزولة بتنعمل وبتنحذف بس جوّا مجلد بيانات رفيق. النموذج ما بيقدر يعمل commit على فرعك ولا يغيّره.</p>
        </div>
        <div class="principle">
          <h3>المتصفح بملف تعريف خاص</h3>
          <p>أدوات المتصفح بتشغّل Edge بملف تعريف منفصل. حساباتك وكوكيزك بمتصفحك العادي ما بتنلمس.</p>
        </div>
        <div class="principle">
          <h3>محرّك محلي بمفتاح جلسة</h3>
          <p>محرّك رفيق بيشتغل على جهازك على منفذ محلي، بتوكن عشوائي لكل تشغيل. ما في عملية تانية على الجهاز بتقدر تناديه.</p>
        </div>
        <div class="principle">
          <h3>التحديثات موقّعة</h3>
          <p>التطبيق بيتحقق من توقيع أي تحديث قبل ما يثبّته. تحديث معدّل ما بيمرق.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="chapter alt">
    <div class="wrap">
      <div class="section-head reveal"><h2>لمين بيتواصل رفيق</h2></div>
      <div class="reveal stack">
        <p>لأربع جهات بس، وكلها بتختارها إنت: المزوّد اللي حطيت مفتاحه، خدمة البحث إذا فعّلتها، خوادم MCP اللي ربطتها، وصفحة إصدارات GitHub لفحص التحديثات. ما في تحليلات ولا تتبّع ولا خادم خاص برفيق.</p>
      </div>
    </div>
  </section>
{download_band(icon, repo)}
"""


# ── Download ───────────────────────────────────────────────────────────────────


def download(logos, icon, repo, base):
    return f"""
  <section class="page-head">
    <div class="wrap reveal">
      <h1>تحميل رفيق لويندوز</h1>
      <p class="lead">مثبّت واحد، بدون حساب. بعد التثبيت ضيف مفتاح نموذجك من صفحة النماذج وابدأ.</p>
      <div class="cta" style="margin-top: 26px">
        <a class="btn btn-primary btn-lg" href="{repo}/releases/latest" data-download>{icon}حمّل لويندوز</a>
        <a class="btn btn-ghost btn-lg" href="{repo}/releases" target="_blank" rel="noopener">كل الإصدارات</a>
      </div>
      <ul class="meta inline">
        <li><b>الإصدار</b><span data-version>0.3.0</span></li>
        <li><b>الحجم</b><span data-size>87 MB</span></li>
        <li><b>النظام</b><span>Windows 10 أو 11، x64</span></li>
      </ul>
    </div>
  </section>

  <section class="chapter">
    <div class="wrap">
      <div class="section-head reveal"><h2>التثبيت</h2></div>
      <div class="steps reveal">
        <div><h3>شغّل المثبّت</h3><p>بيتثبّت للمستخدم الحالي بدون صلاحيات مدير، بالعربية أو الإنجليزية أو الروسية، وبيضيف اختصار بقائمة ابدأ وسطح المكتب.</p></div>
        <div><h3>ضيف نموذج</h3><p>من صفحة النماذج: اختار المزوّد، الصق المفتاح أو سجّل دخول بحساب GitHub، واختار الموديل من القائمة. رفيق بيبعت رسالة تجريبية ليتأكد إنه شغّال.</p></div>
        <div><h3>ابدأ</h3><p>محادثة، أو مهمة على مجلد، أو تصميم. الترقية لنسخة أجدد بتحفظ نماذجك ومحادثاتك ومهامك وحساباتك.</p></div>
      </div>
    </div>
  </section>

  <section class="chapter alt">
    <div class="wrap split">
      <div class="reveal">
        <h2>تحذير SmartScreen</h2>
        <p>المثبّت مش موقّع بشهادة رقمية بعد، فويندوز ممكن يوقّفه أول مرة. اضغط <b>More info</b> ثم <b>Run anyway</b>. وعشان تتأكد إن الملف هو نفسه اللي نشرناه، قارن بصمته مع ملف <code>SHA256SUMS.txt</code> المرفق بالإصدار:</p>
        <pre class="code" dir="ltr"><code>Get-FileHash .\\Rafiq_&lt;version&gt;_x64-setup.exe -Algorithm SHA256</code></pre>
      </div>
      <div class="reveal">
        <h2>التحديثات</h2>
        <p>من صفحة «من نحن» بالتطبيق: فحص، تنزيل، وإعادة تشغيل على النسخة الجديدة. كل تحديث موقّع، والتطبيق بيتحقق من التوقيع قبل ما يثبّته.</p>
        <p style="margin-top: 14px">بتقدر كمان تنزّل أي إصدار يدوياً من صفحة الإصدارات على GitHub وتثبّته فوق الموجود.</p>
      </div>
    </div>
  </section>

  <section class="chapter">
    <div class="wrap">
      <div class="section-head reveal"><h2>وين بتنحفظ بياناتك</h2></div>
      <div class="table-wrap reveal">
        <table>
          <tbody>
            <tr><td>التطبيق</td><td dir="ltr">%LOCALAPPDATA%\\رفيق</td></tr>
            <tr><td>قاعدة البيانات والسجلات</td><td dir="ltr">%APPDATA%\\Rafiq</td></tr>
            <tr><td>المفاتيح والتوكنات</td><td>Windows Credential Manager</td></tr>
            <tr><td>ملفات المهام بدون مجلد، والتصاميم</td><td dir="ltr">%APPDATA%\\Rafiq\\workspace</td></tr>
          </tbody>
        </table>
      </div>
      <p class="muted reveal" style="margin-top: 14px; font-size: 15px">إلغاء التثبيت من Apps &amp; features بيشيل التطبيق وبيخلّي بياناتك بمكانها، فتثبيت لاحق بيرجّعها متل ما كانت.</p>
    </div>
  </section>
"""


# ── FAQ ────────────────────────────────────────────────────────────────────────

FAQ_ITEMS = [
    ("هل رفيق مجاني؟", "التطبيق مجاني والكود على GitHub. اللي بتدفعه هو استهلاك النموذج عند المزوّد اللي اخترته، أو ولا شي إذا شغّلت نموذج محلي عبر Ollama أو LM Studio."),
    ("شو الفرق بينه وبين موقع ChatGPT أو Claude؟", "المواقع بتجاوبك. رفيق بيشتغل: بيقرأ ويكتب ملفاتك، بيشغّل أوامر، بيتصفّح، وبينفّذ مهام كاملة على مجلدك، وكل خطوة حسّاسة بتمرق من إذنك."),
    ("أي نماذج بيدعم؟", "واحد وعشرين مزوّد: Anthropic و OpenAI و Google Gemini و DeepSeek و Mistral و xAI و OpenRouter و GitHub Copilot و Azure OpenAI و AWS Bedrock و Google Vertex AI و Groq و Cerebras و Fireworks و Together و Qwen و Kimi و GLM، ومحلياً Ollama و LM Studio، وأي خادم متوافق مع OpenAI."),
    ("هل بيشتغل بدون إنترنت؟", "مع نموذج محلي (Ollama أو LM Studio) أيوا: الملفات والأوامر والتصاميم كلها محلية. أدوات الويب طبعاً بدها إنترنت."),
    ("هل ملفاتي بتنبعت لحدا؟", "بس اللي النموذج بيطلبه لتنفيذ شغلتك، وبيروح مباشرة للمزوّد اللي حطيت مفتاحه. ما في خادم وسيط خاص برفيق، ولا تحليلات، ولا تتبّع."),
    ("هل بدي اشتراك Copilot؟", "بس إذا بدك تستخدم نماذج GitHub Copilot. بتسجّل دخول بحساب GitHub عليه اشتراك Copilot فعّال، بدون ما تلصق أي مفتاح."),
    ("ليش ويندوز بيحذّرني وقت التثبيت؟", "لأن المثبّت مش موقّع بشهادة رقمية بعد. اضغط More info ثم Run anyway، وقارن بصمة الملف مع SHA256SUMS.txt المرفق بالإصدار إذا بدك تتأكد."),
    ("هل بيشتغل على ماك أو لينكس؟", "حالياً ويندوز 10 و11 فقط. البنية جاهزة لأنظمة تانية، بس ما في نسخة منشورة لها بعد."),
    ("كيف بيعرف رفيق أسعار النماذج؟", "من جدول أسعار المزوّدين نفسه. النموذج اللي ما إله سعر معروف بينعدّ بالتوكنات بس، وما بيخترع رقم."),
    ("لقيت مشكلة، وين بلّغ؟", "افتح issue على GitHub، وأرفق معه تقرير المشاكل من الإعدادات ← الاستهلاك: ملف JSON فيه نسخة التطبيق وإعداداتك وأسماء المزوّدين، بلا أي مفتاح أو محتوى محادثة."),
]


def faq(logos, icon, repo, base):
    items = "".join(
        f'<details class="faq"{" open" if i == 0 else ""}><summary>{q}</summary><p>{a}</p></details>' for i, (q, a) in enumerate(FAQ_ITEMS)
    )
    return f"""
  <section class="page-head">
    <div class="wrap reveal">
      <h1>أسئلة بتتكرر</h1>
      <p class="lead">إذا ما لقيت جوابك، افتح سؤال على GitHub.</p>
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
    "code": "ar",
    "dir": "rtl",
    "name": "العربية",
    "base": "/",
    "brand": "رفيق",
    "download": "حمّل لويندوز",
    "menu": "القائمة",
    "nav_label": "الأقسام",
    "links_label": "روابط",
    "releases": "الإصدارات",
    "report": "بلّغ عن مشكلة",
    "footer_made": 'رفيق · صنعه <a href="https://github.com/AhmadALSaffan" target="_blank" rel="noopener">أحمد عليوي السفان</a>',
    "preload": ["plex-arabic-arabic-700.woff2", "plex-arabic-arabic-400.woff2"],
    "pages": [
        {"path": "", "nav": "الرئيسية", "title": "رفيق · مساعد ذكي على ويندوز بيشتغل على جهازك", "description": "رفيق تطبيق سطح مكتب لويندوز يربطك بالنموذج اللي بتختاره ويعطيه أدوات حقيقية: يقرأ ويكتب ملفات، يشغّل أوامر، يبحث على الويب، ويصمّم واجهات بمعاينة حيّة. عربي من الأساس، وكل شي على جهازك.", "body": home},
        {"path": "features/", "nav": "الميزات", "title": "الميزات · رفيق", "description": "محادثات بأدوات، مهام بالتوازي، نسخة git لكل مهمة، تصميم بمعاينة حيّة، واحد وعشرين مزوّد، جدولة، وكلفة على المكشوف.", "body": features},
        {"path": "security/", "nav": "الأمان", "title": "الأمان والخصوصية · رفيق", "description": "وين بتنحفظ مفاتيحك وبياناتك، كيف بتشتغل سياسة الصلاحيات، ولمين بيتواصل رفيق.", "body": security},
        {"path": "download/", "nav": "التحميل", "title": "تحميل رفيق لويندوز", "description": "مثبّت واحد لويندوز 10 و11، بدون حساب. خطوات التثبيت، التحقق من الملف، والتحديثات.", "body": download},
        {"path": "faq/", "nav": "الأسئلة", "title": "أسئلة بتتكرر · رفيق", "description": "هل هو مجاني؟ أي نماذج بيدعم؟ هل ملفاتي بتنبعت لحدا؟ أجوبة مختصرة.", "body": faq},
    ],
}
