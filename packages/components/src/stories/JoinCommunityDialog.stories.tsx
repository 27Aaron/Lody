import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { JoinCommunityDialog } from '@/components/settings/join-community-dialog';

// QR-looking placeholder so the loaded state renders offline in Storybook;
// the app itself always loads the image from the server worker.
const STORYBOOK_QR_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#fff"/>' +
    '<g fill="#000">' +
    '<path fill-rule="evenodd" d="M4 4h24v24H4zM8 8h16v16H8zM12 12h8v8h-8z"/>' +
    '<path fill-rule="evenodd" d="M72 4h24v24H72zM76 8h16v16H76zM80 12h8v8h-8z"/>' +
    '<path fill-rule="evenodd" d="M4 72h24v24H4zM8 76h16v16H8zM12 80h8v8h-8z"/>' +
    '<rect x="36" y="8" width="4" height="4"/><rect x="44" y="8" width="4" height="4"/>' +
    '<rect x="52" y="12" width="4" height="4"/><rect x="36" y="20" width="4" height="4"/>' +
    '<rect x="60" y="8" width="4" height="4"/><rect x="48" y="24" width="4" height="4"/>' +
    '<rect x="8" y="36" width="4" height="4"/><rect x="16" y="44" width="4" height="4"/>' +
    '<rect x="24" y="40" width="4" height="4"/><rect x="12" y="52" width="4" height="4"/>' +
    '<rect x="36" y="36" width="4" height="4"/><rect x="44" y="44" width="4" height="4"/>' +
    '<rect x="52" y="40" width="4" height="4"/><rect x="40" y="52" width="4" height="4"/>' +
    '<rect x="60" y="48" width="4" height="4"/><rect x="56" y="60" width="4" height="4"/>' +
    '<rect x="72" y="36" width="4" height="4"/><rect x="84" y="40" width="4" height="4"/>' +
    '<rect x="76" y="48" width="4" height="4"/><rect x="88" y="52" width="4" height="4"/>' +
    '<rect x="8" y="60" width="4" height="4"/><rect x="20" y="56" width="4" height="4"/>' +
    '<rect x="72" y="60" width="4" height="4"/><rect x="84" y="64" width="4" height="4"/>' +
    '<rect x="40" y="72" width="4" height="4"/><rect x="52" y="76" width="4" height="4"/>' +
    '<rect x="64" y="72" width="4" height="4"/><rect x="44" y="84" width="4" height="4"/>' +
    '<rect x="60" y="88" width="4" height="4"/><rect x="36" y="92" width="4" height="4"/>' +
    '<rect x="72" y="76" width="4" height="4"/><rect x="84" y="84" width="4" height="4"/>' +
    '<rect x="76" y="92" width="4" height="4"/><rect x="88" y="76" width="4" height="4"/>' +
    '</g></svg>'
)}`;

const meta: Meta<typeof JoinCommunityDialog> = {
  title: 'Components/JoinCommunityDialog',
  component: JoinCommunityDialog,
  args: {
    open: true,
    onOpenChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof JoinCommunityDialog>;

export const Open: Story = {
  args: {
    wechatQrUrl: STORYBOOK_QR_PLACEHOLDER,
  },
};

// A URL that 404s drives the dialog into its QR-load-failure fallback.
export const QrUnavailable: Story = {
  args: {
    wechatQrUrl: '/missing-wechat-qr.png',
  },
};

export const Closed: Story = {
  args: {
    open: false,
  },
};
