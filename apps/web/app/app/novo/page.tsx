import { getPublicSetting } from "@/lib/queries";
import { NewProjectWizard } from "./wizard";

export const metadata = { title: "Novo projeto" };

export default async function NewProjectPage() {
  const [allowed, maxMb] = await Promise.all([
    getPublicSetting<string[]>("allowed_formats", ["wav", "mp3", "flac", "aiff", "aif"]),
    getPublicSetting<number>("max_upload_mb", 50),
  ]);
  return <NewProjectWizard allowed={allowed} maxMb={Number(maxMb)} />;
}
