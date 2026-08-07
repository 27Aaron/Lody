import { downloadHead, DownloadRoutePage } from '@site/src/site-pages';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/download')({
  head: () => downloadHead('en'),
  component: () => <DownloadRoutePage locale="en" />,
});
