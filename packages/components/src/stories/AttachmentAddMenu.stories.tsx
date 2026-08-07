import type { Meta, StoryObj } from '@storybook/react';
import { AttachmentAddMenu } from '@/components/chat/attachment-add-menu';
import { VaulDrawerEdgeBackZone } from '@/components/mobile/vaul-drawer-edge-back-zone';
import { getSessionChatInputAreaShellClassName } from '@/components/sessions/session-chat-input-area';

const meta = {
  title: 'Chat/AttachmentAddMenu',
  component: AttachmentAddMenu,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AttachmentAddMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

// Frame that mimics the bottom-left position of the composer footer so the
// menu opens against a realistic anchor.
const Frame = ({ children, dark }: { children: React.ReactNode; dark?: boolean }) => (
  <div className={dark ? 'dark' : ''}>
    <div className="flex min-h-[420px] items-end bg-background p-4">
      <div className="flex w-full items-center gap-2 rounded-xl border border-input-border bg-input/40 p-2">
        {children}
        <span className="text-sm text-muted-foreground">Message…</span>
      </div>
    </div>
  </div>
);

const NativeSessionFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="relative flex min-h-[420px] flex-col justify-end bg-background">
    <VaulDrawerEdgeBackZone isNativeApp topInset="0px" />
    <div
      className={getSessionChatInputAreaShellClassName({
        protectFromEdgeBackZone: true,
      })}
    >
      <div className="flex w-full items-center gap-2 rounded-xl border border-input-border bg-input/40 p-2">
        {children}
        <span className="text-sm text-muted-foreground">Message…</span>
      </div>
    </div>
  </div>
);

export const DesktopLight: Story = {
  args: { isMobile: false, onAddImage: noop, onAddFile: noop },
  render: (args) => (
    <Frame>
      <AttachmentAddMenu {...args} />
    </Frame>
  ),
};

export const DesktopDark: Story = {
  args: { isMobile: false, onAddImage: noop, onAddFile: noop },
  render: (args) => (
    <Frame dark>
      <AttachmentAddMenu {...args} />
    </Frame>
  ),
};

export const Mobile: Story = {
  args: { isMobile: true, onAddImage: noop, onAddFile: noop },
  render: (args) => (
    <Frame>
      <AttachmentAddMenu {...args} />
    </Frame>
  ),
};

export const NativeSession: Story = {
  args: { isMobile: true, onAddImage: noop, onAddFile: noop },
  render: (args) => (
    <NativeSessionFrame>
      <AttachmentAddMenu {...args} />
    </NativeSessionFrame>
  ),
};

export const Disabled: Story = {
  args: { isMobile: false, disabled: true, onAddImage: noop, onAddFile: noop },
  render: (args) => (
    <Frame>
      <AttachmentAddMenu {...args} />
    </Frame>
  ),
};
