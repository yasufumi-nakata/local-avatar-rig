import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const rootNoticeFiles = ["LICENSE", "ASSET_LICENSE.md", "THIRD_PARTY_NOTICES.md"];

async function listLicenseFiles(root, directory = "LICENSES") {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listLicenseFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Notice must be a regular file or directory: ${relativePath}`);
  }
  return files;
}

/** Read only the explicitly distributed notice files, never arbitrary project paths. */
export async function readNoticeFiles(root = repositoryRoot) {
  const files = [...rootNoticeFiles, ...await listLicenseFiles(root)];
  return Promise.all(files.map(async (fileName) => ({
    fileName,
    source: await readFile(path.join(root, fileName)),
  })));
}

/** Optional standalone helper; Vite uses readNoticeFiles to emit the same files. */
export async function copyNotices(outDir = path.join(repositoryRoot, "dist"), root = repositoryRoot) {
  const files = await readNoticeFiles(root);
  for (const file of files) {
    const target = path.join(outDir, file.fileName);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.source);
  }
  return files.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await copyNotices(process.argv[2] && path.resolve(process.argv[2]));
  console.log(`Copied ${count} license and notice files.`);
}
