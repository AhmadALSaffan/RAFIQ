/** "Save as note" on a chat reply: the reply becomes a note, titled by its first heading. */

import { newNote } from "../../lib/api";
import { noteHeadings } from "../../lib/noteBidi";
import { notify } from "../../lib/toast";
import { t } from "../../i18n";

export async function saveAsNote(text: string, open: (path: string) => void): Promise<void> {
  const heading = noteHeadings(text)[0]?.text;
  const firstLine = text.trim().split("\n")[0].replace(/^[#>*\-+\d.\s]+/, "").trim();
  const title = (heading || firstLine || t("ملاحظة من المحادثة")).slice(0, 70);
  const content = heading ? text : `# ${title}\n\n${text}`;
  try {
    const made = await newNote({ title, content });
    notify({ type: "success", title: t("انحفظت كملاحظة"), description: title, action: { label: t("افتحها"), onClick: () => open(made.path) } });
  } catch (e) {
    notify({ type: "error", title: t("ما قدرت أحفظها"), description: e instanceof Error ? e.message : String(e) });
  }
}
