import type { Meta, StoryObj } from '@storybook/react';
import { toast } from 'sonner';
import { Toaster } from '@/ui/sonner';
import { Button } from '@/ui/button';

/**
 * The global toast surface. Toasts render neutral (no accent color) with a
 * subtle border and an inline close button tucked inside on the right.
 */
const meta: Meta<typeof Toaster> = {
  title: 'UI/Toaster',
  component: Toaster,
  parameters: {
    layout: 'fullscreen',
  },
  render: (args) => (
    <div className="flex min-h-[60vh] flex-col items-start gap-3 p-8">
      <Toaster {...args} />
      <Button
        variant="outline"
        onClick={() =>
          toast.success('Base branch name copied to clipboard')
        }
      >
        Show success toast
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.info('Issue URL copied to clipboard')}
      >
        Show info toast
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.error('Unable to copy link')}
      >
        Show error toast
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast('Session updated', {
            description: 'Your changes were saved to the workspace.',
          })
        }
      >
        Show toast with description
      </Button>
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof Toaster>;

export const Default: Story = {};
