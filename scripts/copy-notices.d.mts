export interface NoticeFile {
  fileName: string;
  source: Uint8Array;
}

export function readNoticeFiles(root?: string): Promise<NoticeFile[]>;
export function copyNotices(outDir?: string, root?: string): Promise<number>;
