import { downloadHead, DownloadRoutePage } from '@site/src/site-pages';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/zh/download')({
  head: () => downloadHead('zh'),
  component: () => <DownloadRoutePage locale="zh" />,
});
